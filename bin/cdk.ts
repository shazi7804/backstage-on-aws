#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { Backstage } from '../lib';

const app = new cdk.App();

new Backstage(app, 'BackstageStack');