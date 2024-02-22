import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecr from 'aws-cdk-lib/aws-ecr';

export interface BackstageProps extends cdk.StackProps {
    readonly cluster_name: string
    readonly repository_name: string
    // readonly backstageImageRepository: ecr.Repository
    // readonly db: rds.DatabaseCluster
    backstage_acm_arn: string
    cluster_database_secret_name: string
    backstage_secret_name: string
}

export class Backstage extends cdk.Stack {
    constructor(scope: Construct, id: string, props: BackstageProps) {
        super(scope, id, props);

        const cluster = eks.Cluster.fromClusterAttributes(this, 'backstage-cluster', {
            clusterName: props.cluster_name,
            kubectlRoleArn: cdk.Fn.importValue('EksClusterKubectlRoleArn')
        });

        const repo = ecr.Repository.fromRepositoryAttributes(this, 'backstage-repo', {
            repositoryName: props.repository_name,
            repositoryArn: 'arn:aws:ecr:' + cluster.stack.region + ':' + cdk.Stack.of(this).account + ':repository/' + props.repository_name,
        });

        const db = rds.DatabaseCluster.fromDatabaseClusterAttributes(this, 'backstage-db', {
            clusterIdentifier: 'backstage'
        });

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
                        "alb.ingress.kubernetes.io/certificate-arn": props.backstage_acm_arn
                    }
                },
                "backstage": {
                    "image": {
                        "registry": this.account + '.dkr.ecr.' + this.region + '.amazonaws.com',
                        "repository": repo.repositoryName,
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
                                    "host": cdk.Fn.importValue('AuroraPostgresEndpoint'),
                                    "port": '5432',
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
                        props.cluster_database_secret_name,
                        props.backstage_secret_name
                    ],
                    "command": ["node", "packages/backend", "--config", "app-config.yaml"]
                }
            }
        })

    }
}