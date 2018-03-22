import { IHTMLTagProvider } from './common';
import { getHTML5TagProvider } from './htmlTags';
import { getSanTagProvider } from './sanTags';
import { getRouterTagProvider } from './routerTags';
export { getComponentTags } from './componentTags';
export { IHTMLTagProvider } from './common';

import * as ts from 'typescript';
import * as fs from 'fs';

export let allTagProviders: IHTMLTagProvider[] = [
    getHTML5TagProvider(),
    getSanTagProvider(),
    getRouterTagProvider(),
];

export interface CompletionConfiguration {
    [provider: string]: boolean;
}

export function getTagProviderSettings(workspacePath: string | null | undefined) {
    const settings: CompletionConfiguration = {
        html5: true,
        san: true,
        router: false,
    };
    if (!workspacePath) {
        return settings;
    }
    try {
        const packagePath = ts.findConfigFile(workspacePath, ts.sys.fileExists, 'package.json');
        if (!packagePath) {
            return settings;
        }
        const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
        if (packageJson.dependencies['san-router']) {
            settings['router'] = true;
        }
    } catch (e) { }
    return settings;
}

export function getEnabledTagProviders(tagProviderSetting: CompletionConfiguration) {
    return allTagProviders.filter(p => tagProviderSetting[p.getId()] !== false);
}
