// this bridge file will be injected into TypeScript service
// it enable type checking and completion, yet still preserve precise option type

export const moduleName = 'san-editor-bridge';
export const moduleImportAsName = '__sanEditorBridge';
export const fileName = 'san-temp/san-editor-bridge.ts';

export const interpolationSurfix = '.__interpolation__';
export const shadowTsSurfix = '.__shadow_ts__';

export const content = `
import San from 'san';
const func = San.defineComponent;
export default func;
`;

export const REG_SAN_DIRECTIVE = /^(san|s|var|on|prop)\-([a-zA-Z\\-]+)$/;
export const REG_SAN_INTERPOLATIONS = /\{\{\s*([\s\S]+?)\s*\}\}|\{\=\s*([\s\S]+?)\s*\=\}/ig
