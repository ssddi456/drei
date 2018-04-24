import * as ts from 'typescript';
import * as path from 'path';
import { ComponentInfoMemberKeys } from "./../../script/findComponents";
import { SanExpression, HTMLDocument, Node } from "../parser/htmlParser";
import { addImportsAndTypeDeclares, insertAccessProperty } from '../../script/insertComponentInfo';
import { endPos, startPos, movePosAstTree, setPosAstTree } from '../../script/astHelper';

export interface InterpolationTreeNode extends ts.TextRange {
    content: string;
    text: string;
}

export interface InterpolationTreeJSON extends ts.TextRange {
    nodes: Array<InterpolationTreeJSON | InterpolationTreeNode>;
    text?: string;
    sanAttribute?: SanExpression;
}
export interface InterpolationTree extends InterpolationTreeJSON {
    nodes: Array<InterpolationTree | InterpolationTreeNode>;
    parent?: InterpolationTree;
    findNameInScope(name: string): boolean;
    toJSON(): InterpolationTreeJSON,
}

export const InterpolationTree = {
    create(
        pos: ts.TextRange,
        parent?: InterpolationTree,
        sanAttribute?: SanExpression
    ): InterpolationTree {

        const newTree: InterpolationTree = {
            ...pos,
            nodes: [],
            parent,
            sanAttribute,
            findNameInScope(this: InterpolationTree, name) {
                if (this.sanAttribute) {
                    if (name == this.sanAttribute.itemName
                        || name == this.sanAttribute.indexName
                    ) {
                        return true;
                    }
                }
                if (this.parent) {
                    return this.parent.findNameInScope(name);
                }
                return false;
            },
            toJSON() {
                return {
                    pos: this.pos,
                    end: this.end,
                    nodes: this.nodes,
                    sanAttribute,
                    text: this.text,
                }
            }
        };
        if (parent) {
            parent.nodes.push(newTree);
        }
        return newTree;
    }
}

function createDerivedFromFilePath(fileName: string, derivedFromFile: string) {
    return './' + path.relative(path.dirname(fileName), derivedFromFile);
}

export function interpolationTreeToSourceFIle(
    interpolationTree: InterpolationTree,
    originSourceFIle: ts.SourceFile,
    componentInfo: ComponentInfoMemberKeys
): ts.SourceFile {

    const statements = [] as ts.Statement[];

    const derivedFromFilePath = createDerivedFromFilePath(originSourceFIle.fileName, componentInfo.fileName);

    addImportsAndTypeDeclares(statements,
        createDerivedFromFilePath(originSourceFIle.fileName, componentInfo.fileName),
        componentInfo.computedKeys);

    const magicIdx = '__idx';
    const magicPlaceholder = '__placeholder';

    let magicIdxCounter = 0;
    let magicPlaceholderCounter = 0;

    function visit(interpolationTree: InterpolationTree, currentStatments: ts.Statement[]) {
        interpolationTree.nodes.forEach(function (node) {

            if (!(node as InterpolationTree).nodes) {
                // this should be a InterpolationTreeNode
                const interpolationNode = node as InterpolationTreeNode;

                if (interpolationTree.sanAttribute) {
                    const sanAttribute = interpolationTree.sanAttribute;
                    /**
                     * check san-for  infos, skip these nodes;
                     */
                    if (isSanForInterpolationNode(interpolationNode, sanAttribute)) {
                        return;
                    }
                }

                const tempSourceFile = ts.createSourceFile('test.ts', node.text, ts.ScriptTarget.ES5);
                for (let index = 1; index < tempSourceFile.statements.length; index++) {
                    const statement = tempSourceFile.statements[index];

                    const transformed = ts.transform(statement, [
                        insertAccessProperty(
                            componentInfo.dataKeys,
                            componentInfo.initDataReturnKeys,
                            componentInfo.computedKeys,
                            interpolationTree,
                        )]).transformed[0];

                    currentStatments.push(transformed as ts.Statement);
                }

            } else if ((node as InterpolationTree).sanAttribute) {

                const sanAttribute = (node as InterpolationTree).sanAttribute!;
                const withExpression = sanAttribute.iteratorString!;
                const getWithExpressionAst = () => {
                    const tempSourceFile = ts.createSourceFile('test.ts', withExpression, ts.ScriptTarget.ES5);
                    const expression = (tempSourceFile.statements[0] as ts.ExpressionStatement).expression;
                    console.assert(expression, 'should always got this');

                    const transformed = ts.transform(expression, [
                        insertAccessProperty(
                            componentInfo.dataKeys,
                            componentInfo.initDataReturnKeys,
                            componentInfo.computedKeys,
                            interpolationTree,
                        )]).transformed[0] as typeof expression;

                    return transformed;
                };

                const localmagicIdx = magicIdx + magicIdxCounter;
                magicIdxCounter++;

                const localMagicPlaceholder = magicPlaceholder + magicPlaceholderCounter;
                magicPlaceholderCounter++;
                //
                // so we need the valueAccess expression
                // these should be at the san-for expression
                //
                const itemEndPos = endPos(sanAttribute.itemPos);
                const itemDeclare = ts.setTextRange(ts.createVariableDeclaration(
                    ts.setTextRange(ts.createIdentifier(sanAttribute.itemName), sanAttribute.itemPos),
                    undefined,
                    setPosAstTree(
                        ts.createElementAccess(
                            getWithExpressionAst(),
                            ts.createIdentifier(localmagicIdx),
                        ),
                        itemEndPos)
                ), sanAttribute.itemPos);

                const indexPos: ts.TextRange = sanAttribute.indexPos || { pos: itemEndPos.pos + 1, end: itemEndPos.end };
                const indexDeclare = ts.setTextRange(ts.createVariableDeclaration(
                    ts.setTextRange(ts.createIdentifier(sanAttribute.indexName), indexPos),
                    undefined,
                    ts.setTextRange(ts.createIdentifier(localmagicIdx), endPos(indexPos)),
                ), indexPos);

                const iteratorRange: ts.TextRange = { pos: sanAttribute.itemPos.pos, end: sanAttribute.iteratorPos.pos - 1 }
                const newStatements = [
                    ts.setTextRange(ts.createVariableStatement(
                        undefined,
                        ts.setTextRange(ts.createVariableDeclarationList(
                            ts.setTextRange(ts.createNodeArray([
                                itemDeclare,
                                indexDeclare,
                            ], true), iteratorRange),
                            ts.NodeFlags.Const
                        ), iteratorRange)
                    ), iteratorRange),
                    
                    ts.setTextRange(ts.createStatement(
                        movePosAstTree(getWithExpressionAst(), sanAttribute.iteratorPos.pos)
                    ), sanAttribute.iteratorPos),
                ];

                const forStartPos = startPos(node);

                // wait statements to be filled
                visit(node as InterpolationTree, newStatements);

                currentStatments.push(
                    // should be the whole tag
                    ts.setTextRange(ts.createFor(
                        // at start of the tag

                        setPosAstTree(ts.createVariableDeclarationList(
                            [ts.createVariableDeclaration(
                                ts.createIdentifier(localmagicIdx),
                                undefined,
                                ts.createNumericLiteral('0')
                            )],
                            ts.NodeFlags.Let
                        ), forStartPos),

                        setPosAstTree(ts.createBinary(
                            ts.createIdentifier(localmagicIdx),
                            ts.SyntaxKind.LessThanToken,
                            ts.createPropertyAccess(
                                getWithExpressionAst(),
                                ts.createIdentifier('length')
                            )
                        ), forStartPos),

                        setPosAstTree(ts.createPostfixIncrement(
                            ts.createIdentifier(localmagicIdx)
                        ), forStartPos),
                        // end at start of the tag

                        ts.setTextRange(ts.createBlock(
                            ts.setTextRange(ts.createNodeArray(
                                newStatements,
                                true
                            ), node),
                            true
                        ), node)
                    ), node)
                );
            } else {
                visit(node as InterpolationTree, currentStatments);
            }
        });
    }

    visit(interpolationTree, statements);

    originSourceFIle.statements = ts.setTextRange(ts.createNodeArray(statements), interpolationTree);

    return originSourceFIle;
}

export function templateToInterpolationTree(text: string, htmlDocument: HTMLDocument): InterpolationTree {

    const root = InterpolationTree.create({
        pos: htmlDocument.roots[0].pos,
        end: htmlDocument.roots.slice(-1).pop()!.end,
    });

    const originBackgroundText = text.replace(/./g, ' ');
    let interpolationText = originBackgroundText

    function appendNodeText(node: Node) {
        interpolationText = interpolationText.slice(0, node.pos) + node.text + interpolationText.slice(node.end);
    }
    function visitNode(node: Node, currentRoot: InterpolationTree) {
        if (node.tag && node.attributes && (node.attributes['san-for'] || node.attributes['s-for']) && node.sanAttributes) {
            const sanAttribute = (node.sanAttributes['san-for'] || node.sanAttributes['s-for']) as SanExpression;

            const newRoot = InterpolationTree.create({
                pos: node.pos,
                end: node.end,
            }, currentRoot, sanAttribute);


            visitEachChild(node, newRoot);

        } else if (node.isInterpolation) {
            console.assert(node.text.length === (node.end - node.pos), 'node.length should equals node.end - node.start');
            currentRoot.nodes.push({
                pos: node.pos,
                end: node.end,
                content: node.text,
                text: originBackgroundText.slice(0, node.pos - 1) + ';' + node.text
            });
            appendNodeText(node);
        } else {
            visitEachChild(node, currentRoot);
        }
    }

    function visitEachChild(node: Node, currentRoot: InterpolationTree) {
        node.children.forEach(node => visitNode(node, currentRoot));
    }

    htmlDocument.roots.forEach(node => visitNode(node, root));
    root.text = interpolationText;
    return root;
}

export function isSanForInterpolationNode(node: InterpolationTreeNode, sanAttribute: SanExpression) {
    /**
     * check san-for  infos, skip these nodes;
     */
    if (
        (
            node.content === sanAttribute.itemName
            && node.pos == sanAttribute.itemPos!.pos
            && node.end == sanAttribute.itemPos!.end
        )
        || (sanAttribute.indexPos && (
            node.content === sanAttribute.indexName
            && node.pos == sanAttribute.indexPos.pos
            && node.end == sanAttribute.indexPos.end)
        )
        || (
            node.content === sanAttribute.iteratorString
            && node.pos == sanAttribute.iteratorPos!.pos
            && node.end == sanAttribute.iteratorPos!.end
        )
    ) {
        return true;
    }
    return false;
}
