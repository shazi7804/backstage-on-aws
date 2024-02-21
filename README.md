# Backstage on AWS

## Prerequisites

The following prerequisites are required to complete this workshop:

- A computer with an internet connection running Microsoft Windows, Mac OSX, or Linux.
- An internet browser such as Chrome, Firefox, Safari, Opera, or Edge.
- Access to an email account to login to Workshop Studio.

## Getting started 

### AWS Cloud9 Setup

In this section we are going to familiarize ourselves with the Cloud9 environment that has been provisioned and pre-configured. AWS Cloud9 is a cloud-based integrated development environment (IDE) that lets you write, run, and debug your code with just a browser.

Navigate to the Cloud9 console . There is a Cloud9 environment provisioned named `CDKDEV`. Click Open.

On the left hand side of the Cloud9 IDE, you will see a folder. This is your source code and where we will create files.

On the bottom of the Cloud9 IDE, you will see a terminal window. This is where we will enter commands.

### Backstage Setup

- Create two SSL certifications for Backstage and Argo CD

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