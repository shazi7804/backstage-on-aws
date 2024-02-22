# Backstage on AWS

## Prerequisites

The following prerequisites are required to complete this workshop:

- A computer with an internet connection running Microsoft Windows, Mac OSX, or Linux.
- An internet browser such as Chrome, Firefox, Safari, Opera, or Edge.
- Access to an email account to login to Workshop Studio.

## Getting started 

### AWS Environment Setup

```
export AWS_REGION=us-east-1
export AWS_ACCOUNT=<your-account-id>
```

#### AWS Cloud9 Setup

In this section we are going to familiarize ourselves with the Cloud9 environment that has been provisioned and pre-configured. AWS Cloud9 is a cloud-based integrated development environment (IDE) that lets you write, run, and debug your code with just a browser.

Navigate to the Cloud9 console . There is a Cloud9 environment provisioned named `CDKDEV`. Click Open.

On the left hand side of the Cloud9 IDE, you will see a folder. This is your source code and where we will create files.

On the bottom of the Cloud9 IDE, you will see a terminal window. This is where we will enter commands.

#### Toolkit Setup

Next, we'll install the AWS CDK Toolkit. The toolkit is a command-line utility which allows you to work with CDK apps.

```
> npm install -g aws-cdk yarn
> cdk --version
2.128.0 (build d995261)

> curl -O https://s3.us-west-2.amazonaws.com/amazon-eks/1.28.5/2024-01-04/bin/linux/amd64/kubectl
> chmod +x ./kubectl
> sudo mv kubectl /usr/local/bin/
> kubectl version --client
Client Version: v1.28.5
```

### Backstage Setup

#### Create two SSL certifications for Backstage and Argo CD

```
# backstage.local
> openssl req -newkey rsa:2048 -new -nodes -x509 -days 365 -keyout backstage.local.key -out backstage.local.cert
...
Common Name (e.g. server FQDN or YOUR name) []: backstage.local

> aws acm import-certificate --certificate fileb://$(pwd)/backstage.local.cert --private-key fileb://$(pwd)/backstage.local.key
{
    "CertificateArn": "arn:aws:acm:us-east-1:xxxxx:certificate/xxxxx"
}

export BACKSTAGE_ACM_ARN="arn:aws:acm:us-east-1:xxxxx:certificate/xxxxx"

echo $BACKSTAGE_ACM_ARN
```


```
# argocd.local
> openssl req -newkey rsa:2048 -new -nodes -x509 -days 365 -keyout argocd.local.key -out argocd.local.cert

Common Name (e.g. server FQDN or YOUR name) []: argocd.local

> aws acm import-certificate --certificate fileb://$(pwd)/argocd.local.cert --private-key fileb://$(pwd)/argocd.local.key
{
    "CertificateArn": "arn:aws:acm:us-east-1:xxxxx:certificate/xxxxx"
}

export ARGOCD_ACM_ARN="arn:aws:acm:us-east-1:xxxxx:certificate/xxxxx"

echo $ARGOCD_ACM_ARN
```

#### Export Github credential

```
export GITHUB_TOKEN=xxxx
export AUTH_GITHUB_CLIENT_ID=xxxx
export AUTH_GITHUB_CLIENT_SECRET=xxx
```

#### Deploy backstage infrastructure

- Upload backstage application to Amazon ECR image
```
# Build backstage
> cd backstage/ && yarn install
> yarn build:backend --config ../../app-config.yaml

# Build image
> DOCKER_BUILDKIT=1 docker build . -t backstage
> docker tag backstage $ECR_REPO
```

- Deploy backstage infra like ECR, EKS and addons.
```
> git clone https://github.com/shazi7804/backstage-on-aws
> cd backstage-on-aws
> yarn install
> cdk bootstrap

 ✅  Environment aws://xxxxx/us-east-1 bootstrapped.

> cdk deploy BackstageInfraStack
Do you wish to deploy these changes (y/n)? y
```


