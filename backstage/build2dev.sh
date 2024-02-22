#!/bin/bash

AWS_ACCOUNT="381354187112"
REGION="us-east-1"
ECR_REPO="381354187112.dkr.ecr.us-east-1.amazonaws.com/backstage:latest"

yarn build:backend --config ../../app-config.yaml
docker buildx build \
    --load \
    --tag backstage \
    .
./run.sh
