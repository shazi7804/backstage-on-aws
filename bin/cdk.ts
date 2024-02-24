#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { BackstageInfra } from '../lib/infra';

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
    github_token: process.env.GITHUB_TOKEN as string,
    auth_github_client_id: process.env.AUTH_GITHUB_CLIENT_ID as string,
    auth_github_client_secret: process.env.AUTH_GITHUB_CLIENT_SECRET as string,
});

app.synth();