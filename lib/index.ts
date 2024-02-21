import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretm from 'aws-cdk-lib/aws-secretsmanager';
// import { KubectlLayer } from "aws-cdk-lib/lambda-layer-kubectl";
import { KubectlV28Layer } from '@aws-cdk/lambda-layer-kubectl-v28';
import fs = require('fs');

export interface BackstageProps extends cdk.StackProps {

}

export class Backstage extends cdk.Stack {
    constructor(scope: Construct, id: string) {
        super(scope, id);

        const commonProps = {
            cluster_name: 'backstage',
            database_username: 'postgres',
            database_port: 5432,
            repositoryName: 'demobackstage',
            namespace: 'backstage',
            cluster_database_secret_name: 'backstage-database-secret',
            backstage_secret_name: 'backstage-secret',
            backstage_acm_arn: process.env.BACKSTAGE_ACM_ARN as string,
            argocd_acm_arn: process.env.ARGOCD_ACM_ARN as string,
            github_client_id: process.env.AUTH_GITHUB_CLIENT_ID as string,
            github_client_secret: process.env.AUTH_GITHUB_CLIENT_SECRET as string,
            github_token: process.env.GITHUB_TOKEN as string
        }

        const subnetProps = [
            {
                name: "PublicSubnet",
                cidrMask: 20,
                subnetType: ec2.SubnetType.PUBLIC
            },
            {
                name: "PrivateSubnet",
                cidrMask: 20,
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
            }
        ]

        const vpc = new ec2.Vpc(this, 'backstageVpc', {
            ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
            maxAzs: 2,
            natGateways: 1,
            subnetConfiguration: subnetProps
        });

        const mastersRole = new iam.Role(this, 'admin-role', {
            assumedBy: new iam.AccountRootPrincipal()
        });

        const cluster = new eks.Cluster(this, 'eks-cluster', {
            clusterName: commonProps.cluster_name,
            vpc,
            vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }],
            defaultCapacity: 1,
            mastersRole,
            version: eks.KubernetesVersion.V1_28,
            kubectlLayer: new KubectlV28Layer(this, 'LayerVersion'),
            endpointAccess: eks.EndpointAccess.PUBLIC_AND_PRIVATE
        });
        const nodeGroup = cluster.addAutoScalingGroupCapacity('worker-node', {
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.M5, ec2.InstanceSize.XLARGE),
            maxInstanceLifetime: cdk.Duration.days(7),
            minCapacity: 1,
        })

        const databaseSecret = new secretm.Secret(this, "database-secret", {
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    username: commonProps.database_username,
                }),
                excludePunctuation: true,
                includeSpace: false,
                generateStringKey: "password"
            }
        });

        const backstageSecret = new secretm.Secret(this, "backstage-secret", {
            secretObjectValue: {
                githubToken: cdk.SecretValue.unsafePlainText(commonProps.github_token),
                githubClientId: cdk.SecretValue.unsafePlainText(commonProps.github_client_id),
                githubClientSecret: cdk.SecretValue.unsafePlainText(commonProps.github_client_secret),
                backstageAcmArn: cdk.SecretValue.unsafePlainText(commonProps.backstage_acm_arn),
                argocdAcmArn: cdk.SecretValue.unsafePlainText(commonProps.argocd_acm_arn),
            }
        });

        // Patch aws-node daemonset to use IRSA via EKS Addons, do before nodes are created
        // https://aws.github.io/aws-eks-best-practices/security/docs/iam/#update-the-aws-node-daemonset-to-use-irsa
        const awsNodeTrustPolicy = new cdk.CfnJson(this, 'aws-node-trust-policy', {
            value: {
              [`${cluster.openIdConnectProvider.openIdConnectProviderIssuer}:aud`]: 'sts.amazonaws.com',
              [`${cluster.openIdConnectProvider.openIdConnectProviderIssuer}:sub`]: 'system:serviceaccount:kube-system:aws-node',
            },
        });
        const awsNodePrincipal = new iam.OpenIdConnectPrincipal(cluster.openIdConnectProvider).withConditions({
            StringEquals: awsNodeTrustPolicy,
        });
        const awsNodeRole = new iam.Role(this, 'aws-node-role', {
            assumedBy: awsNodePrincipal
        })

        const awsAuth = new eks.AwsAuth(this, 'aws-auth', {cluster})
        awsAuth.addRoleMapping(mastersRole, {
            username: 'masterRole',
            groups: ['system:masters']
        });

        // Addons
        new eks.CfnAddon(this, 'vpc-cni', {
            addonName: 'vpc-cni',
            resolveConflicts: 'OVERWRITE',
            clusterName: cluster.clusterName,
            serviceAccountRoleArn: awsNodeRole.roleArn
        });
        new eks.CfnAddon(this, 'kube-proxy', {
            addonName: 'kube-proxy',
            resolveConflicts: 'OVERWRITE',
            clusterName: cluster.clusterName,
        });
        new eks.CfnAddon(this, 'core-dns', {
            addonName: 'coredns',
            resolveConflicts: 'OVERWRITE',
            clusterName: cluster.clusterName,
        });

        awsNodeRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'))

        /////////////////////////////////////
        // Addons : External Secrets
        const externalSecretsNamespace = cluster.addManifest("external-secrets-namespace", {
            apiVersion: "v1",
            kind: "Namespace",
            metadata: { name: "external-secrets" },
        });

        const externalSecretsServiceAccount = cluster.addServiceAccount(
            "ExternalSecretsServiceAccount",
            {
              namespace: "external-secrets",
              name: "external-secrets-service-account",
            }
        );
        externalSecretsServiceAccount.node.addDependency(externalSecretsNamespace);

        const externalSecretsAccessPolicy = new iam.Policy(this, "external-secrets-access-policy", {
            statements: [
              new iam.PolicyStatement({
                actions: [
                    "secretsmanager:GetResourcePolicy",
                    "secretsmanager:GetSecretValue",
                    "secretsmanager:DescribeSecret",
                    "secretsmanager:ListSecretVersionIds",
                    "secretsmanager:ListSecrets",
                    "ssm:DescribeParameters",
                    "ssm:GetParameter",
                    "ssm:GetParameters",
                    "ssm:GetParametersByPath",
                    "ssm:GetParameterHistory",
                    "kms:Decrypt"
                ],
                resources: ["*"],
              }),
            ],
        });
        externalSecretsServiceAccount.role.attachInlinePolicy(externalSecretsAccessPolicy);

        const externalSecretsHelmChartProps = {
            name: "external-secrets",
            chart: "external-secrets",
            release: "blueprints-addon-external-secrets",
            version: "0.9.9",
            repository: "https://charts.external-secrets.io",
            namespace: "external-secrets",
            wait: true,
            timeout: cdk.Duration.minutes(15),
            values: {},
            
        }
        const externalSecretsHelmChart = cluster.addHelmChart('external-secrets-helm-chart', externalSecretsHelmChartProps)
        externalSecretsHelmChart.node.addDependency(externalSecretsServiceAccount);

        const clusterSecretStoreName = "secret-manager-store";
        const clusterSecretStore = new eks.KubernetesManifest(cluster.stack, "ClusterSecretStore", {
            cluster: cluster,
            manifest: [
                {
                    apiVersion: "external-secrets.io/v1beta1",
                    kind: "ClusterSecretStore",
                    metadata: {
                        name: clusterSecretStoreName,
                        namespace: commonProps.namespace
                    },
                    spec: {
                        provider: {
                            aws: {
                                service: "SecretsManager",
                                region: cluster.stack.region,
                                auth: {
                                    jwt: {
                                        serviceAccountRef: {
                                            name: "external-secrets-service-account",
                                            namespace: "external-secrets",
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            ],
        })
        clusterSecretStore.node.addDependency(externalSecretsHelmChart);
        clusterSecretStore.node.addDependency(externalSecretsServiceAccount);


        const databaseExternalSecret = new eks.KubernetesManifest(cluster.stack, "BackstageDatabaseExternalSecret", {
            cluster: cluster,
            manifest: [
                {
                    apiVersion: "external-secrets.io/v1beta1",
                    kind: "ExternalSecret",
                    metadata: {
                        name: "external-backstage-db-secret",
                        namespace: commonProps.namespace
                    },
                    spec: {
                        secretStoreRef: {
                            name: clusterSecretStoreName,
                            kind: "ClusterSecretStore",
                        },
                        target: {
                            name: commonProps.cluster_database_secret_name,
                        },
                        data: [
                            {
                                secretKey: "POSTGRES_PASSWORD",
                                remoteRef: {
                                    key: databaseSecret.secretName,
                                    property:  "password"
                                }
                            },
                            {
                                secretKey: "POSTGRES_USER",
                                remoteRef: {
                                    key: databaseSecret.secretName,
                                    property:  "username"
                                }
                            },
                        ],
                    },
                },
            ],
        })
        databaseExternalSecret.node.addDependency(externalSecretsHelmChart);
        databaseExternalSecret.node.addDependency(externalSecretsServiceAccount);
        
        ///////////////////////////////////
        // Addons : AWS load balancer controller
        const iamIngressPolicyDocument = JSON.parse(fs.readFileSync('lib/files/aws-lb-controller-v2.5.4-iam-policy.json').toString());
        const iamIngressPolicy = new iam.Policy(this, 'aws-load-balancer-controller-policy', {
            policyName: 'AWSLoadBalancerControllerIAMPolicy',
            document: iam.PolicyDocument.fromJson(iamIngressPolicyDocument),
        })

        const awsAlbControllerServiceAccount = cluster.addServiceAccount('aws-load-balancer-controller', {
            name: 'aws-load-balancer-controller',
            namespace: 'kube-system',
        });
        awsAlbControllerServiceAccount.role.attachInlinePolicy(iamIngressPolicy);

        const awsLoadBalancerControllerChart = cluster.addHelmChart('aws-loadbalancer-controller', {
            chart: 'aws-load-balancer-controller',
            repository: 'https://aws.github.io/eks-charts',
            namespace: 'kube-system',
            release: 'aws-load-balancer-controller',
            version: '1.7.1',
            wait: true,
            timeout: cdk.Duration.minutes(15),
            values: {
                clusterName: cluster.clusterName,
                serviceAccount: {
                create: false,
                name: awsAlbControllerServiceAccount.serviceAccountName,
                },
                // must disable waf features for aws-cn partition
                enableShield: false,
                enableWaf: false,
                enableWafv2: false,
            },
        });
        awsLoadBalancerControllerChart.node.addDependency(nodeGroup);
        awsLoadBalancerControllerChart.node.addDependency(awsAlbControllerServiceAccount);
        awsLoadBalancerControllerChart.node.addDependency(cluster.openIdConnectProvider);
        awsLoadBalancerControllerChart.node.addDependency(cluster.awsAuth);

        /////////////////////////////////////
        // Addons : Crossplane
        const crossplaneNamespaceName = "crossplane"
        const crossplaneNamespace = cluster.addManifest('crossplane-namespace', {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: {
                name: crossplaneNamespaceName
            }
        })

        const crossplaneServiceAccount = cluster.addServiceAccount('crossplane-controller-sa', {
            name: "crossplane-aws-irsa",
            namespace: crossplaneNamespaceName
        })
        crossplaneServiceAccount.node.addDependency(crossplaneNamespace)
        crossplaneServiceAccount.role.attachInlinePolicy(new iam.Policy(this, 'crossplane-aws-policy', {
            statements: [
                new iam.PolicyStatement({
                    resources: ['*'],
                    actions: [
                        "iam:*",
                        "sts:*",
                    ],
                }),
            ],
        }))

        const crossplaneHelmChartAddOn = cluster.addHelmChart('crossplane-helm-chart', {
            chart: 'crossplane',
            release: 'crossplane',
            version: '1.15.0',
            repository: 'https://charts.crossplane.io/stable',
            namespace: crossplaneNamespaceName,
            createNamespace: false,
            timeout: cdk.Duration.minutes(10),
            wait: true,
            values: {
                tolerations: [
                    {
                        key: 'CriticalAddonsOnly',
                        operator: 'Exists',
                    },
                ],
                rbacManager: {
                    tolerations: [
                        {
                            key: 'CriticalAddonsOnly',
                            operator: 'Exists',
                        },
                    ],
                }
            }
        })
        crossplaneHelmChartAddOn.node.addDependency(crossplaneNamespace)
        crossplaneHelmChartAddOn.node.addDependency(awsLoadBalancerControllerChart)

        const crossplaneControllerConfig = cluster.addManifest("crossplane-controller-config", {
            apiVersion: 'pkg.crossplane.io/v1alpha1',
            kind: 'ControllerConfig',
            metadata: {
                name: 'aws-config',
                annotations: {
                    'eks.amazonaws.com/role-arn': crossplaneServiceAccount.role.roleArn
                }
            },
            spec: {
                podSecurityContext: {
                    'fsGroup': 2000
                },
                tolerations: [
                    {
                        key: 'CriticalAddonsOnly',
                        operator: 'Exists',
                    },
                ],
            },
        });
        crossplaneControllerConfig.node.addDependency(crossplaneHelmChartAddOn)


        const crossplaneAwsProviderManifest = cluster.addManifest("crossplane-aws-provider", {
            apiVersion: 'pkg.crossplane.io/v1',
            kind: 'Provider',
            metadata: {
                name: 'upbound-provider-family-aws',
            },
            spec: {
                package: 'xpkg.upbound.io/upbound/provider-family-aws:v1.1.0',
                controllerConfigRef: {
                    name: 'aws-config',
                },
            },
        });
        crossplaneAwsProviderManifest.node.addDependency(crossplaneControllerConfig)
        
        const crossplaneKubernetesProviderManifest = cluster.addManifest("crossplane-kubernetes-provider", {
            apiVersion: 'pkg.crossplane.io/v1',
            kind: 'Provider',
            metadata: {
                name: 'provider-terraform',
            },
            spec: {
                package: 'xpkg.upbound.io/upbound/provider-terraform:v0.14.1',
            },
        });
        crossplaneKubernetesProviderManifest.node.addDependency(crossplaneControllerConfig)

        /////////////////////////////////////
        // Addons : ArgoCD
        const argoNamespaceName = "argocd"
        const argoNamespace = cluster.addManifest('argo-namespace', {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: {
                name: argoNamespaceName
            }
        });

        const argoHelmChartAddOn = cluster.addHelmChart('argo-helm-chart', {
            repository: "https://argoproj.github.io/argo-helm",
            chart: "argo-cd",
            release: "argocd",
            namespace: "argocd",
            values: {
                server: {
                    ingress: {
                        enabled: true,
                        annotations: {
                            "kubernetes.io/ingress.class": "alb",
                            "alb.ingress.kubernetes.io/scheme": "internet-facing",
                            "alb.ingress.kubernetes.io/target-type": "ip",
                            "alb.ingress.kubernetes.io/target-group-attributes": "stickiness.enabled=true,stickiness.lb_cookie.duration_seconds=60",
                            "alb.ingress.kubernetes.io/group.name": "argo",
                            "alb.ingress.kubernetes.io/group.order": "1",
                            // Needed when using TLS.
                            "alb.ingress.kubernetes.io/backend-protocol": "HTTPS",
                            "alb.ingress.kubernetes.io/healthcheck-protocol": "HTTPS",
                            // "alb.ingress.kubernetes.io/listen-ports": '[{"HTTP":80}, {"HTTPS":443}]'
                            "alb.ingress.kubernetes.io/listen-ports": '[{"HTTPS":443}]',
                            "alb.ingress.kubernetes.io/certificate-arn": commonProps.argocd_acm_arn
                        },
                        paths: ["/"]
                    }
                }
            }
        });
        argoHelmChartAddOn.node.addDependency(crossplaneNamespace)
        argoHelmChartAddOn.node.addDependency(awsLoadBalancerControllerChart)

        const argoRolloutsNamespaceName = "argocd-rollouts"
        const argoRolloutsNamespace = cluster.addManifest('argo-rollouts-namespace', {
            apiVersion: 'v1',
            kind: 'Namespace',
            metadata: {
                name: argoRolloutsNamespaceName
            }
        });

        const argoRolloutsHelmChartAddOn = cluster.addHelmChart('argo-rollouts-helm-chart', {
            repository: "https://argoproj.github.io/argo-helm",
            chart: "argo-rollouts",
            release: "argo-rollouts",
            namespace: argoRolloutsNamespaceName,
            // https://artifacthub.io/packages/helm/argo/argo-rollouts
            values: {
                installCRDs: true,
                dashboard: {
                    enabled: true,
                    ingress: {
                        enabled: true,
                        annotations: {
                            // Ingress core settings.
                            "kubernetes.io/ingress.class": "alb",
                            "alb.ingress.kubernetes.io/scheme": "internet-facing",
                            "alb.ingress.kubernetes.io/target-type": "ip",
                            "alb.ingress.kubernetes.io/target-group-attributes": "stickiness.enabled=true,stickiness.lb_cookie.duration_seconds=60",
                            "alb.ingress.kubernetes.io/success-codes": "200,404,301,302",
                            "alb.ingress.kubernetes.io/group.name": "argo",
                            "alb.ingress.kubernetes.io/group.order": "2"
                        },
                        paths: ["/rollouts"]
                    }
                },
            }
        });
        argoRolloutsHelmChartAddOn.node.addDependency(argoRolloutsNamespace)
        argoRolloutsHelmChartAddOn.node.addDependency(awsLoadBalancerControllerChart)

        const databaseSecurityGroup = new ec2.SecurityGroup(this, "backstage-db-security-group", {
            vpc: vpc
        });

        const engine = rds.DatabaseClusterEngine.auroraPostgres({ version: rds.AuroraPostgresEngineVersion.of('15.4', '15') });
        const parameterGroup = new rds.ParameterGroup(this, '-parameter-group', {
            engine,
            description: 'Parameter group for Backstage',
            parameters: {
              'rds.force_ssl': '0'
            },
        });
        
        databaseSecurityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(commonProps.database_port), "Connect from within VPC");

        const db = new rds.DatabaseCluster(this, "backstage-database-instance", {
            engine,
            vpc,
            vpcSubnets: {
                subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
            },
            parameterGroup,
            securityGroups: [databaseSecurityGroup],
            credentials: rds.Credentials.fromSecret(databaseSecret),
            writer: rds.ClusterInstance.provisioned('writer', {
                instanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.XLARGE4),
            }),
        });

        const backstageImageRepository = new ecr.Repository(this, "backstageImageRepository", {
            repositoryName: commonProps.repositoryName
        });

        const backstageNamespace = new eks.KubernetesManifest(cluster.stack, "BackstageNamespace", {
            cluster: cluster,
            manifest: [
                {
                    apiVersion: "v1",
                    kind: "Namespace",
                    metadata: { name: commonProps.namespace }
                },
            ],
        });

        const backstageExternalSecret = new eks.KubernetesManifest(cluster.stack, "BackstageExternalSecret", {
            cluster: cluster,
            manifest: [
                {
                    apiVersion: "external-secrets.io/v1beta1",
                    kind: "ExternalSecret",
                    metadata: {
                        name: "external-backstage-secret",
                        namespace: commonProps.namespace
                    },
                    spec: {
                        secretStoreRef: {
                            name: clusterSecretStoreName,
                            kind: "ClusterSecretStore",
                        },
                        target: {
                            name: commonProps.backstage_secret_name,
                        },
                        data: [
                            {
                                secretKey: "GITHUB_TOKEN",
                                remoteRef: {
                                    key: backstageSecret.secretName,
                                    property:  "githubToken"
                                }
                            },
                            {
                                secretKey: "AUTH_GITHUB_CLIENT_ID",
                                remoteRef: {
                                    key: backstageSecret.secretName,
                                    property:  "githubClientId"
                                }
                            },
                            {
                                secretKey: "AUTH_GITHUB_CLIENT_SECRET",
                                remoteRef: {
                                    key: backstageSecret.secretName,
                                    property:  "githubClientSecret"
                                }
                            },
                            {
                                secretKey: "BACKSTAGE_ACM_ARN",
                                remoteRef: {
                                    key: backstageSecret.secretName,
                                    property:  "backstageAcmArn"
                                }
                            },
                            {
                                secretKey: "ARGOCD_ACM_ARN",
                                remoteRef: {
                                    key: backstageSecret.secretName,
                                    property:  "argocdAcmArn"
                                }
                            },
                        ],
                    },
                },
            ],
        })
        backstageExternalSecret.node.addDependency(externalSecretsHelmChart);
        backstageExternalSecret.node.addDependency(externalSecretsServiceAccount);

        const backstageHelmChartAddOn = cluster.addHelmChart('backstage-helmchart', {
            chart: 'backstage',
            namespace: 'backstage',
            release: 'backstage',
            version: '1.8.2',
            repository: 'https://backstage.github.io/charts',
            wait: true,
            timeout: cdk.Duration.minutes(15),
            values: {
                "ingress": {
                    "enabled": true,
                    "className": "alb",
                    // "host"
                    "annotations": {
                        "alb.ingress.kubernetes.io/scheme": "internet-facing",
                        "alb.ingress.kubernetes.io/target-type": "ip",
                        "alb.ingress.kubernetes.io/certificate-arn": commonProps.backstage_acm_arn
                    }
                },
                "backstage": {
                    "image": {
                        "registry": this.account + '.dkr.ecr.' + cluster.stack.region + '.amazonaws.com',
                        "repository": backstageImageRepository.repositoryName,
                        "tag": 'latest'
                    },
                    "appConfig": {
                        "app": { 
                            "baseUrl": 'http://localhost'
                        },
                        "backend": {
                            "baseUrl": 'http://localhost',
                            "database": {
                                "client": "pg",
                                "connection": {
                                    "host": db.clusterEndpoint.hostname,
                                    "port": db.clusterEndpoint.port,
                                    "user": "${POSTGRES_USER}",
                                    "password": "${POSTGRES_PASSWORD}"
                                }
                            }
                        },
                        "auth": {
                            "providers": {
                                "github": {
                                    "development": {
                                        "clientId": "${AUTH_GITHUB_CLIENT_ID}",
                                        "clientSecret": "${AUTH_GITHUB_CLIENT_SECRET}"
                                    }
                                }
                            }
                        },
                        "integrations": {
                            "github": [{
                                "host": "github.com",
                                "token": "${GITHUB_TOKEN}"
                            }]
                        }
                    },
                    "extraEnvVarsSecrets": [
                        commonProps.cluster_database_secret_name,
                        commonProps.backstage_secret_name
                    ],
                    "command": ["node", "packages/backend", "--config", "app-config.yaml"]
                }
            }
        })
        backstageHelmChartAddOn.node.addDependency(awsLoadBalancerControllerChart);
        backstageHelmChartAddOn.node.addDependency(backstageNamespace);
        backstageHelmChartAddOn.node.addDependency(backstageExternalSecret);

    }
}