import { IHTMLTagProvider } from './common';
import { getHTML5TagProvider } from './htmlTags';
import { getSanTagProvider } from './sanTags';
import { getRouterTagProvider } from './routerTags';
import { elementTagProvider, onsenTagProvider, bootstrapTagProvider, santifyTagProvider } from './externalTagProviders';
export { getComponentTags } from './componentTags';
export { IHTMLTagProvider } from './common';

import * as ts from 'typescript';
import * as fs from 'fs';

export let allTagProviders: IHTMLTagProvider[] = [
    getHTML5TagProvider(),
    getSanTagProvider(),
    getRouterTagProvider(),
    elementTagProvider,
    onsenTagProvider,
    bootstrapTagProvider,
    santifyTagProvider
];

export interface CompletionConfiguration {
    [provider: string]: boolean;
}

export function getTagProviderSettings(workspacePath: string | null | undefined) {
    const settings: CompletionConfiguration = {
        html5: true,
        san: true,
        router: false,
        element: false,
        onsen: false,
        bootstrap: false,
        santify: false
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
        if (packageJson.dependencies['element-ui']) {
            settings['element'] = true;
        }
        if (packageJson.dependencies['san-onsenui']) {
            settings['onsen'] = true;
        }
        if (packageJson.dependencies['bootstrap-san']) {
            settings['bootstrap'] = true;
        }
        if (packageJson.dependencies['santify']) {
            settings['santify'] = true;
        }
    } catch (e) { }
    return settings;
}

export function getEnabledTagProviders(tagProviderSetting: CompletionConfiguration) {
    return allTagProviders.filter(p => tagProviderSetting[p.getId()] !== false);
}
