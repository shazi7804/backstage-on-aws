terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.36"
    }
  }

  required_version = ">= 1.7.3"
}

provider "aws" {
  region = var.aws_region
}

resource "aws_instance" "example_server" {
  ami           = var.instance_image_id
  instance_type = var.instance_type

  tags = {
    Name = var.instance_name
  }
}