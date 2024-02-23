#!/bin/bash

## Need to input
export AWS_REGION=your-region
export AWS_ACCOUNT=your-account-id
export GITHUB_TOKEN=your-github-token
export AUTH_GITHUB_CLIENT_ID=your-github-auth-app-client-id
export AUTH_GITHUB_CLIENT_SECRET=your-github-auth-app-client-secret
export ARGOCD_ACM_ARN="arn:aws:acm:..."
export BACKSTAGE_ACM_ARN="arn:aws:acm:..."

##
export ECR_REPO_NAME=backstage
export ECR_REPO_URI="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPO_NAME}:latest"

# Toolkit setup
## Install AWS CDK and YARN
npm install -g aws-cdk@latest yarn --force
cdk --version

## Install Kubectl
curl -O https://s3.us-west-2.amazonaws.com/amazon-eks/1.28.5/2024-01-04/bin/linux/amd64/kubectl
chmod +x ./kubectl
sudo install -m 555 kubectl /usr/local/bin/kubectl
rm kubectl
kubectl version --client

## Install Argocd
curl -sSL -o argocd-linux-amd64 https://github.com/argoproj/argo-cd/releases/latest/download/argocd-linux-amd64
sudo install -m 555 argocd-linux-amd64 /usr/local/bin/argocd
rm argocd-linux-amd64
argocd version


# Build Backstage infra and application
## Application

cd backstage/ && yarn install
yarn build:backend --config ../../app-config.yaml

# Build backstage image
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin ${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com
aws ecr create-repository \
    --repository-name $ECR_REPO_NAME \
    --region $AWS_REGION

DOCKER_BUILDKIT=1 docker build . -t backstage
docker tag backstage $ECR_REPO_URI
docker push $ECR_REPO_URI

## Infra deploy
cd ../ && yarn install
cdk bootstrap aws://${AWS_ACCOUNT}/${AWS_REGION}
npx cdk deploy BackstageInfraStack --require-approval never

