export type {
  EmbedDefinition,
  EmbedRenderContext,
  RendererOptions,
  UnknownEmbedBehavior,
} from './types';
export { parseParams } from './attrs';
export { EmbedRegistry } from './registry';
export { createRegistry, createRenderer, type CreateRendererOptions, type XdocRenderer } from './renderer';
export { builtinEmbeds, calloutEmbed, htmlEmbed, tableEmbed, todoEmbed } from './embeds/index';
export { highlightCode } from './highlight';