#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { BackstageInfra } from '../lib/infra';
import { Backstage } from '../lib/backstage';

const app = new cdk.App();

const backstageInfra = new BackstageInfra(app, 'BackstageInfraStack', {
    cluster_name: 'backstage',
    database_username: 'postgres',
    database_port: 5432,
    repository_name: 'backstage',
    namespace: 'backstage',
    cluster_database_secret_name: 'backstage-database-secret',
    backstage_secret_name: 'backstage-secret',
    backstage_acm_arn: process.env.BACKSTAGE_ACM_ARN as string,
    argocd_acm_arn: process.env.ARGOCD_ACM_ARN as string,
    github_token: process.env.GITHUB_TOKEN as string
});

// new Backstage(app, 'BackstageAppStack', {
//     cluster_name: 'backstage',
//     repository_name: 'backstage',
//     backstage_acm_arn: process.env.BACKSTAGE_ACM_ARN as string,
//     cluster_database_secret_name: 'backstage-database-secret',
//     backstage_secret_name: process.env.BACKSTAGE_ACM_ARN as string
// });

app.synth();