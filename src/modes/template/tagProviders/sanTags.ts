/* tslint:disable:max-line-length */
import {
    HTMLTagSpecification,
    IHTMLTagProvider,
    collectTagsDefault,
    collectAttributesDefault,
    collectValuesDefault,
    genAttribute,
    AttributeCollector,
    Priority
} from './common';

const u: undefined = undefined;

const sanDirectives = [
    genAttribute('s-html', u, 'Updates the element’s `innerHTML`. XSS prone.', 'san-html'),
    genAttribute('s-if', u, 'Conditionally renders the element based on the truthy-ness of the expression value.', 'san-if'),
    genAttribute('s-else', 'v', 'Denotes the “else block” for `s-if` or a `s-if`/`s-else-if` chain.', 'san-else'),
    genAttribute('s-elif', u, 'Denotes the “else if block” for `s-if`. Can be chained.', 'san-elif'),
    genAttribute('s-for', u, 'Renders the element or template block multiple times based on the source data.', 'san-for'),

    genAttribute('slot', u, 'Used on content inserted into child components to indicate which named slot the content belongs to.'),
];

const sanTags = {
    component: new HTMLTagSpecification(
        'A meta component for rendering dynamic components. The actual component to render is determined by the `is` prop.',
        [
            genAttribute('is', u, 'the actual component to render'),
            genAttribute('inline-template', 'v', 'treat inner content as its template rather than distributed content')
        ]
    ),
    slot: new HTMLTagSpecification(
        '<slot> serve as content distribution outlets in component templates. <slot> itself will be replaced.',
        [genAttribute('name', u, 'Used for named slot')]
    ),
};

const valueSets = {
    transMode: ['out-in', 'in-out'],
    transType: ['transition', 'animation'],
    b: ['true', 'false']
};

export function getSanTagProvider(): IHTMLTagProvider {
    return {
        getId: () => 'san',
        priority: Priority.Framework,
        collectTags: collector => collectTagsDefault(collector, sanTags),
        collectAttributes: (tag: string, collector: AttributeCollector) => {
            collectAttributesDefault(tag, collector, sanTags, sanDirectives);
        },
        collectValues: (tag: string, attribute: string, collector: (value: string) => void) => {
            collectValuesDefault(tag, attribute, collector, sanTags, sanDirectives, valueSets);
        }
    };
}
