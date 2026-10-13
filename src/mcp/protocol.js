'use strict';

const types = require('@modelcontextprotocol/sdk/types.js');

const REQUESTS = {
  'tools/list': [types.ListToolsRequestSchema, types.ListToolsResultSchema, 'tools'],
  'tools/call': [types.CallToolRequestSchema, types.CallToolResultSchema, 'tools'],
  'resources/list': [types.ListResourcesRequestSchema, types.ListResourcesResultSchema, 'resources'],
  'resources/templates/list': [types.ListResourceTemplatesRequestSchema, types.ListResourceTemplatesResultSchema, 'resources'],
  'resources/read': [types.ReadResourceRequestSchema, types.ReadResourceResultSchema, 'resources'],
  'prompts/list': [types.ListPromptsRequestSchema, types.ListPromptsResultSchema, 'prompts'],
  'prompts/get': [types.GetPromptRequestSchema, types.GetPromptResultSchema, 'prompts'],
};
const NOTIFICATIONS = [
  types.ToolListChangedNotificationSchema,
  types.ResourceListChangedNotificationSchema,
  types.PromptListChangedNotificationSchema,
];

function bridgeCapabilities(remote) {
  const result = {};
  for (const name of ['tools', 'resources', 'prompts']) {
    if (remote?.[name]) result[name] = { listChanged: remote[name].listChanged === true };
  }
  return result;
}

module.exports = { REQUESTS, NOTIFICATIONS, bridgeCapabilities };
