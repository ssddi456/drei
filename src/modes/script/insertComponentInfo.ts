import * as ts from 'typescript';
import {
    createIdentifier,
    createImportDeclaration,
    createNamespaceImport,
    createImportClause,
    createLiteral,
    createNamedImports,
    createImportSpecifier,
    vts,
    startPos,
    setPosAstTree,
} from './astHelper';
import { InterpolationTree } from '../template/services/interpolationTree';
import { logger } from '../../utils/logger';

const insertedName = 'instance';
const computedTypeName = 'computedTypeName';

const DataTypeName = 'DataType';
const instanceDataTypeName = 'instanceDataType';

const OtherTypeNmae = 'OtherType';
const instanceOtherTypeName = 'instanceOtherType';

const instaceComputedObjectName = 'instanceComputedObject';

export function addImportsAndTypeDeclares(
    statements: ts.Statement[],
    derivedFromFileRelativePath: string,
    computedKeys: string[],
) {
    logger.log(() => 'insert import dependance');
    // import { default as instance } from 'derivedFromFileRelativePath'
    statements.push(
        createImportDeclaration(
            undefined,
            undefined,
            createImportClause(undefined,
                createNamedImports(
                    [createImportSpecifier(
                        createIdentifier('default'),
                        createIdentifier(insertedName))
                    ]
                )
            ),
            createLiteral(derivedFromFileRelativePath)
        )
    );
    // impot * as San from 'san'
    statements.push(createImportDeclaration(
        undefined,
        undefined,
        createImportClause(undefined,
            createNamespaceImport(
                createIdentifier('San')
            )),
        createLiteral('san')
    ));
    // type DataType<T> = T extends San.ComponentConstructor<infer U, any> ? U : never;
    statements.push(vts.createTypeAliasDeclaration(
        undefined,
        undefined,
        vts.createIdentifier(DataTypeName),
        [vts.createTypeParameterDeclaration(
            vts.createIdentifier('T'),
            undefined,
            undefined,
        )],
        vts.createConditionalTypeNode(
            vts.createTypeReferenceNode(
                vts.createIdentifier('T'),
                undefined
            ),
            vts.createTypeReferenceNode(
                vts.createQualifiedName(
                    vts.createIdentifier('San'),
                    vts.createIdentifier('ComponentConstructor')
                ),
                [vts.createInferTypeNode(
                    vts.createTypeParameterDeclaration(
                        vts.createIdentifier('U'))),
                vts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword)]
            ),
            vts.createTypeReferenceNode(
                vts.createIdentifier('U'),
                undefined
            ),
            vts.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
        )
    ));
    // type OtherType<T> = T extends San.ComponentConstructor<any, infer U> ? U : never;
    statements.push(vts.createTypeAliasDeclaration(
        undefined,
        undefined,
        vts.createIdentifier(OtherTypeNmae),
        [vts.createTypeParameterDeclaration(
            vts.createIdentifier('T'),
            undefined,
            undefined,
        )],
        vts.createConditionalTypeNode(
            vts.createTypeReferenceNode(
                vts.createIdentifier('T'),
                undefined
            ),
            vts.createTypeReferenceNode(
                vts.createQualifiedName(
                    vts.createIdentifier('San'),
                    vts.createIdentifier('ComponentConstructor')
                ),
                [
                    vts.createKeywordTypeNode(ts.SyntaxKind.AnyKeyword),
                    vts.createInferTypeNode(
                        vts.createTypeParameterDeclaration(
                            vts.createIdentifier('U'))),
                ]
            ),
            vts.createTypeReferenceNode(
                vts.createIdentifier('U'),
                undefined
            ),
            vts.createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
        )
    ));

    // type instanceDataType = DataType<typeof instance>;'
    statements.push(vts.createTypeAliasDeclaration(
        undefined,
        undefined,
        vts.createIdentifier(instanceDataTypeName),
        undefined,
        vts.createTypeReferenceNode(
            vts.createIdentifier(DataTypeName),
            [vts.createTypeQueryNode(
                vts.createIdentifier(insertedName)
            )]
        )
    ));

    // type instanceOtherType = OtherType<typeof instance>;'
    statements.push(vts.createTypeAliasDeclaration(
        undefined,
        undefined,
        vts.createIdentifier(instanceOtherTypeName),
        undefined,
        vts.createTypeReferenceNode(
            vts.createIdentifier(OtherTypeNmae),
            [vts.createTypeQueryNode(
                vts.createIdentifier(insertedName)
            )]
        )
    ));

    if (computedKeys.length) {
        // const instanceComputedObject = ({} as instanceOtherType).computed;
        statements.push(
            vts.createVariableStatement(
                undefined,
                vts.createVariableDeclarationList(
                    [
                        vts.createVariableDeclaration(
                            vts.createIdentifier(instaceComputedObjectName),
                            undefined,
                            vts.createPropertyAccess(
                                vts.createParen(
                                    vts.createAsExpression(
                                        vts.createObjectLiteral(),
                                        vts.createTypeReferenceNode(
                                            vts.createIdentifier(instanceDataTypeName),
                                            undefined
                                        )
                                    )
                                ),
                                vts.createIdentifier('computed'))
                        )
                    ],
                    ts.NodeFlags.Const
                )
            )
        );
        /**
         * type computedTypeName = {
         *    a234: ReturnType<typeof instanceComputedObject.a234>;
         * };
         */
        const members = computedKeys.map(x => {
            return vts.createPropertySignature(
                undefined,
                vts.createIdentifier(x),
                undefined,
                vts.createTypeReferenceNode(
                    vts.createIdentifier('ReturnType'),
                    [vts.createTypeQueryNode(
                        vts.createQualifiedName(
                            vts.createIdentifier(instaceComputedObjectName),
                            vts.createIdentifier(x)))]
                ),
                undefined)
        });
        statements.push(
            vts.createTypeAliasDeclaration(
                undefined,
                undefined,
                vts.createIdentifier(computedTypeName),
                undefined,
                vts.createTypeLiteralNode(members)
            )
        );
    }
}



export function insertAccessProperty(
    dataKeys: string[],
    initDataReturnKeys: string[],
    computedKeys: string[],
    interpolationTree: InterpolationTree,
) {

    return function findInsertPoint<T extends ts.Node>(context: ts.TransformationContext) {
        return function (rootNode: T) {

            let lastNoneIdentifierNodeKind: ts.SyntaxKind;
            let lastNodeKind: ts.SyntaxKind;

            function visit(node: ts.Node): ts.Node {
                logger.log(() => "Visiting " + ts.SyntaxKind[node.kind]);

                if (node.kind == ts.SyntaxKind.ImportDeclaration
                    || node.kind == ts.SyntaxKind.TypeAliasDeclaration
                ) {
                    return node;
                }

                if (node.kind == ts.SyntaxKind.BinaryExpression) {
                    if ((node as ts.BinaryExpression).operatorToken.kind == ts.SyntaxKind.BarToken) {
                        const filterExpression = node as ts.BinaryExpression;
                        const right = filterExpression.right;

                        if (right.kind !== ts.SyntaxKind.Identifier
                            && right.kind !== ts.SyntaxKind.CallExpression
                        ) {
                            throw "Syntax Error here";
                        }

                        const propAccess = ts.createBinary(
                            ts.visitEachChild(filterExpression.left, visit, context),
                            filterExpression.operatorToken,

                            // funtion call or identifir so we'll deal it later
                            ts.visitEachChild(right, visit, context)
                        );

                        lastNodeKind = node.kind;
                        return ts.visitEachChild(propAccess, visit, context);
                    }
                }

                if (node.kind == ts.SyntaxKind.Identifier) {
                    logger.log(() => (node as ts.Identifier).escapedText);

                    if (lastNodeKind !== ts.SyntaxKind.Identifier
                        || lastNoneIdentifierNodeKind !== ts.SyntaxKind.PropertyAccessExpression
                    ) {
                        const propertyNode = node as ts.Identifier;
                        const propertyName = propertyNode.escapedText as string;
                        lastNodeKind = node.kind;

                        if (interpolationTree.findNameInScope(propertyName)) {
                            return node;
                        }

                        logger.log(() => ['insert instance identifier', propertyNode.escapedText]);
                        let insertNode: ts.Expression;
                        const nodeStartPos = startPos(node);

                        if ((dataKeys && dataKeys.includes(propertyName))
                            || (initDataReturnKeys && initDataReturnKeys.includes(propertyName))
                        ) {
                            insertNode = ts.createParen(
                                ts.createAsExpression(
                                    ts.createObjectLiteral(undefined, false),
                                    ts.createTypeReferenceNode(
                                        ts.createIdentifier(instanceDataTypeName), undefined)
                                ));
                        } else if (computedKeys && computedKeys.includes(propertyName)) {
                            insertNode = ts.createParen(
                                ts.createAsExpression(
                                    ts.createObjectLiteral(undefined, false),
                                    ts.createTypeReferenceNode(
                                        ts.createIdentifier(computedTypeName), undefined)
                                ));
                        } else {
                            // others
                            insertNode = ts.createIdentifier(insertedName);
                        }

                        const propAccess = ts.setTextRange(
                            ts.createPropertyAccess(
                                setPosAstTree(insertNode, nodeStartPos),
                                node as ts.Identifier
                            ),
                            node);

                        return propAccess;
                    }
                } else {
                    lastNodeKind = node.kind;
                    lastNoneIdentifierNodeKind = node.kind;
                }
                return ts.visitEachChild(node, visit, context);
            }
            return ts.visitNode(rootNode, visit);
        }
    }
}
