#!/bin/bash

AWS_ACCOUNT="381354187112"
AWS_REGION="us-east-1"
ECR_REPO="${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com/backstage:latest"

aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin ${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com

yarn build:backend --config ../../app-config.yaml
docker buildx build \
    --platform linux/amd64,linux/arm64 \
    --push \
    --tag $ECR_REPO \
    .
