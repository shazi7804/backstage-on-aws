import { CatalogClient } from '@backstage/catalog-client';
import {
  UrlReader,
} from '@backstage/backend-common';
import { 
  createRouter,
  createBuiltinActions,
  TemplateAction
} from '@backstage/plugin-scaffolder-backend';
import { Config } from '@backstage/config';
import { ScmIntegrations } from '@backstage/integration';
import { Router } from 'express';
import type { PluginEnvironment } from '../types';

import {
  createZipAction,
  createSleepAction,
  createWriteFileAction,
  createAppendFileAction,
  createMergeJSONAction,
  createMergeAction,
  createParseFileAction,
  createSerializeYamlAction,
  createSerializeJsonAction,
  createJSONataAction,
  createYamlJSONataTransformAction,
  createJsonJSONataTransformAction,
} from '@roadiehq/scaffolder-backend-module-utils';

export const createActions = (options: {
  reader: UrlReader;
  integrations: ScmIntegrations;
  config: Config;
  catalogClient: CatalogClient;
}): TemplateAction<any>[] => {
  const { reader, integrations, config, catalogClient } = options;
  const defaultActions = createBuiltinActions({
    reader,
    integrations,
    catalogClient,
    config,
  });

  return [
    createZipAction(),
    createSleepAction(),
    createWriteFileAction(),
    createAppendFileAction(),
    createMergeJSONAction({}),
    createMergeAction(),
    createParseFileAction(),
    createSerializeYamlAction(),
    createSerializeJsonAction(),
    createJSONataAction(),
    createYamlJSONataTransformAction(),
    createJsonJSONataTransformAction(),
    ...defaultActions,
  ];
};

// export default async function createPlugin(
//   env: PluginEnvironment,
// ): Promise<Router> {
//   const catalogClient = new CatalogClient({
//     discoveryApi: env.discovery,
//   });


//   return await createRouter({
//     logger: env.logger,
//     config: env.config,
//     database: env.database,
//     reader: env.reader,
//     catalogClient,
//     identity: env.identity,
//     permissions: env.permissions,
//   });
// }

export default async function createPlugin({
  logger,
  config,
  database,
  reader,
  discovery,
}: PluginEnvironment): Promise<Router> {
  const catalogClient = new CatalogClient({ discoveryApi: discovery });

  return await createRouter({
    logger,
    config,
    database,
    catalogClient,
    reader,
    actions: createActions({
      reader,
      integrations: ScmIntegrations.fromConfig(config),
      config,
      catalogClient: catalogClient
    }),
  });
}