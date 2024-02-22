import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as eks from 'aws-cdk-lib/aws-eks';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as ecr from 'aws-cdk-lib/aws-ecr';

export interface BackstageProps extends cdk.StackProps {
    readonly cluster: eks.Cluster
    readonly backstageImageRepository: ecr.Repository
    readonly db: rds.DatabaseCluster
    backstage_acm_arn: string
    cluster_database_secret_name: string
    backstage_secret_name: string
}

export class Backstage extends cdk.Stack {
    constructor(scope: Construct, id: string, props: BackstageProps) {
        super(scope, id, props);
        const backstageHelmChartAddOn = props.cluster.addHelmChart('backstage-helmchart', {
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
                        "registry": this.account + '.dkr.ecr.' + props.cluster.stack.region + '.amazonaws.com',
                        "repository": props.backstageImageRepository.repositoryName,
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
                                    "host": props.db.clusterEndpoint.hostname,
                                    "port": props.db.clusterEndpoint.port,
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