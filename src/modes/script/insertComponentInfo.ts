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
    createVts,
    typeNodeFromString,
} from './astHelper';
import { InterpolationTree } from '../template/services/interpolationTree';
import { logger } from '../../utils/logger';
import { ComponentInfoProvider } from './findComponents';

const insertedName = 'instance';

const DataTypeName = 'DataType';
const instanceDataTypeName = 'instanceDataType';

const OtherTypeNmae = 'OtherType';
const instanceOtherTypeName = 'instanceOtherType';

const instaceComputedObjectName = 'instanceComputedObject';

export function addImportsAndTypeDeclares(
    statements: ts.Statement[],
    derivedFromFileRelativePath: string,
    derivedFromJs: boolean,
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

    if (derivedFromJs) {
        addImportsAndTypeDeclaresForJsSource(statements, computedKeys);
    } else {
        addImportsAndTypeDeclaresForTsSource(statements, computedKeys);
    }
}

function addImportsAndTypeDeclaresForJsSource(
    statements: ts.Statement[],
    computedKeys: string[],
) {
    // type instanceDataType = typeof instance.data;
    statements.push(vts.createTypeAliasDeclaration(
        undefined,
        undefined,
        vts.createIdentifier(instanceDataTypeName),
        undefined,
        vts.createTypeQueryNode(
            vts.createQualifiedName(
                vts.createIdentifier(insertedName),
                vts.createIdentifier('data')
            )
        )
    ));

    // to avoid unused error
    statements.push(vts.createStatement(
        ts.createParen(
            ts.createAsExpression(
                vts.createObjectLiteral(),
                vts.createTypeReferenceNode(
                    vts.createIdentifier(instanceDataTypeName),
                    undefined
                )
            )
        )
    ));


    // type instanceOtherType = typeof instance;'
    statements.push(vts.createTypeAliasDeclaration(
        undefined,
        undefined,
        vts.createIdentifier(instanceOtherTypeName),
        undefined,
        vts.createTypeQueryNode(
            vts.createIdentifier(insertedName),
        )
    ));

    // to avoid unused error
    statements.push(vts.createStatement(
        ts.createParen(
            ts.createAsExpression(
                vts.createObjectLiteral(),
                vts.createTypeReferenceNode(
                    vts.createIdentifier(instanceOtherTypeName),
                    undefined
                )
            )
        )
    ));

    if (computedKeys.length) {
        // const instanceComputedObject = instance.computed;
        statements.push(
            vts.createVariableStatement(
                undefined,
                vts.createVariableDeclarationList(
                    [
                        vts.createVariableDeclaration(
                            vts.createIdentifier(instaceComputedObjectName),
                            undefined,
                            vts.createPropertyAccess(
                                vts.createIdentifier(insertedName),
                                vts.createIdentifier('computed'))
                        )
                    ],
                    ts.NodeFlags.Const
                )
            )
        );
    }
}
function addImportsAndTypeDeclaresForTsSource(
    statements: ts.Statement[],
    computedKeys: string[],
) {

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

    // to avoid unused error
    statements.push(vts.createStatement(
        ts.createParen(
            ts.createAsExpression(
                vts.createObjectLiteral(),
                vts.createTypeReferenceNode(
                    vts.createIdentifier(instanceDataTypeName),
                    undefined
                )
            )
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
    
    // to avoid unused error
    statements.push(vts.createStatement(
        ts.createParen(
            ts.createAsExpression(
                vts.createObjectLiteral(),
                vts.createTypeReferenceNode(
                    vts.createIdentifier(instanceOtherTypeName),
                    undefined
                )
            )
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
                                            vts.createIdentifier(instanceOtherTypeName),
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
                            const startPosVts = createVts(nodeStartPos);
                            const wrapPosVts = createVts(node);
                            const computedReturnType = wrapPosVts.createTypeReferenceNode(
                                startPosVts.createIdentifier('ReturnType'),
                                [
                                    wrapPosVts.createTypeQueryNode(
                                        wrapPosVts.createQualifiedName(
                                            startPosVts.createIdentifier(instaceComputedObjectName),
                                            node as ts.Identifier))
                                ]);

                            console.log('computedReturnType.typeArguments!.pos', computedReturnType.typeArguments);

                            ts.setTextRange(computedReturnType.typeArguments!, node);

                            insertNode = wrapPosVts.createParen(
                                wrapPosVts.createAsExpression(
                                    startPosVts.createObjectLiteral(undefined, false),
                                    computedReturnType
                                ));

                            return insertNode;
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

const reservedConfigMethodNames = [
    'initData',
    'compiled',
    'inited',
    'created',
    'attached',
    'detached',
    'disposed',
    'updated',
];

const componentExportName = 'componentExports__';
const componentDataTypeName = 'componentDataType__';
const componentMethodTypeName = 'componentMethodType__';
const componentComponentType = 'componentComponentType__';

export function insertDataTypeAndMethodsType(
    source: ts.SourceFile,
    componentInfo: ComponentInfoProvider,
) {
    /**
     * 
     * type DataType = {}
     * type MethodType = {
     *      methodName(this: ComponentType, ...) : ....
     * }
     * type ComponentType = San.SanComponent<DataType> & MethodType
     * 
     */

    const uuid = '';
    const unicExportName = componentExportName + uuid;

    const uniqDataTypeName = componentDataTypeName + uuid;
    const uniqMethodTypeName = componentMethodTypeName + uuid;
    const uniqComponentType = componentComponentType + uuid;

    let dataProperty = componentInfo.getPropertyType('data');
    const initDataProperty = componentInfo.getPropertyType('initData') as ts.ObjectType;;

    if (!dataProperty) {
        if (initDataProperty) {
            dataProperty = (initDataProperty && (initDataProperty.objectFlags & ts.ObjectFlags.Anonymous)) ?
                componentInfo.checker.getSignaturesOfType(initDataProperty, ts.SignatureKind.Call)[0].getReturnType() : null as ts.Type;
        }
    }
    // make data type here
    const dataTypeString = dataProperty ? componentInfo.checker.typeToString(dataProperty) : '';
    function getDataTypeNode() {
        return dataTypeString ? typeNodeFromString(dataTypeString) : ts.createTypeLiteralNode([]);
    }
    logger.log(() => ['dataTypeString', dataTypeString]);

    // make methods type here

    const methodKeys = componentInfo.getMemberKeys().allMemberFunctionKeys.filter(x => reservedConfigMethodNames.indexOf(x) === -1);
    function getMethodTypeNode() {
        return methodKeys.length
            ? ts.createTypeLiteralNode(methodKeys.map(x => {
                const methodType = componentInfo.getPropertyType(x);

                const methodTypeNode = typeNodeFromString(
                    componentInfo.checker.typeToString(
                        methodType)) as ts.FunctionTypeNode;

                const parameters = methodTypeNode.parameters;
                const signature = (componentInfo.checker.getSignaturesOfType(
                    methodType, ts.SignatureKind.Call
                )[0] as any) as ts.MethodSignature;
                const thisParameter = signature.thisParameter;

                console.log('signature', x, signature);
                console.log('thisParameter', x, thisParameter);

                if (!thisParameter) {
                    ((parameters as any) as ts.ParameterDeclaration[]).unshift(
                        ts.createParameter(
                            undefined,
                            undefined,
                            undefined,
                            ts.createIdentifier('this'),
                            undefined,

                            ts.createTypeReferenceNode(
                                ts.createIdentifier(uniqComponentType),
                                undefined
                            )
                        ));
                }
                return ts.createPropertySignature(
                    undefined,
                    ts.createIdentifier(x),
                    undefined,
                    methodTypeNode,
                    undefined);
            }))
            : ts.createTypeLiteralNode([]);
    }
    // so we can solve everything

    function modify<T extends ts.Node>(context: ts.TransformationContext) {
        return function (rootNode: T): ts.Node {

            let defaultExportVisitCount = 0;

            function visit(node: ts.Node): ts.Node {
                if (node.kind == ts.SyntaxKind.ExportAssignment) {
                    const exportNode = node as ts.ExportAssignment;
                    console.log('exportNode.name', exportNode.name);

                    if (defaultExportVisitCount > 0) {
                        return node;
                    }
                    defaultExportVisitCount++;

                    const constVts = createVts(exportNode);
                    const exprVts = createVts(startPos(exportNode.expression));

                    return constVts.createVariableDeclarationList(
                        [constVts.createVariableDeclaration(
                            exprVts.createIdentifier(unicExportName),
                            exprVts.createTypeReferenceNode(
                                exprVts.createQualifiedName(
                                    exprVts.createIdentifier('San'),
                                    exprVts.createIdentifier('SanComponentConfig')
                                ),
                                [
                                    exprVts.createTypeReferenceNode(
                                        exprVts.createIdentifier(uniqDataTypeName),
                                        undefined
                                    ),
                                    exprVts.createTypeReferenceNode(
                                        exprVts.createIdentifier(uniqMethodTypeName),
                                        undefined),
                                ]
                            ), // we need make a expression here
                            exportNode.expression
                        )],
                        ts.NodeFlags.Const
                    );

                } else if (node.kind == ts.SyntaxKind.SourceFile) {
                    const sourceFileNode = node as ts.SourceFile;
                    const statements = (sourceFileNode.statements as any) as ts.Node[];

                    const fileLength = sourceFileNode.getText().length;
                    if (!statements.length) {
                        logger.log(() => ['this file has no statements', sourceFileNode.fileName, 'fileLength', fileLength]);
                        return sourceFileNode;
                    }
                    const lastStatementEnd = sourceFileNode.statements[sourceFileNode.statements.length - 1].end;
                    const endOfFile = { pos: lastStatementEnd, end: lastStatementEnd + 1 };
                    logger.log(() => ['append exports at end of file', endOfFile]);
                    const endVts = createVts(endOfFile);

                    statements.unshift(endVts.createImportDeclaration(
                        undefined,
                        undefined,
                        endVts.createImportClause(undefined,
                            endVts.createNamespaceImport(
                                endVts.createIdentifier('San')
                            )),
                        endVts.createLiteral('san')
                    ));

                    statements.push(endVts.createTypeAliasDeclaration(
                        undefined,
                        undefined,
                        endVts.createIdentifier(uniqDataTypeName),
                        undefined,
                        setPosAstTree(getDataTypeNode(), endOfFile)
                    ));
                    statements.push(endVts.createTypeAliasDeclaration(
                        undefined,
                        undefined,
                        endVts.createIdentifier(uniqMethodTypeName),
                        undefined,
                        setPosAstTree(getMethodTypeNode(), endOfFile)
                    ));
                    statements.push(endVts.createTypeAliasDeclaration(
                        undefined,
                        undefined,
                        endVts.createIdentifier(uniqComponentType),
                        undefined,
                        endVts.createIntersectionTypeNode([
                            endVts.createTypeReferenceNode(
                                endVts.createQualifiedName(
                                    endVts.createIdentifier('San'),
                                    endVts.createIdentifier('SanComponent')
                                ),
                                [
                                    endVts.createTypeReferenceNode(
                                        endVts.createIdentifier(uniqDataTypeName),
                                        undefined
                                    ),
                                ]
                            ),
                            endVts.createTypeReferenceNode(
                                endVts.createIdentifier(uniqMethodTypeName),
                                undefined
                            )
                        ])
                    ));

                    statements.push(
                        endVts.createExportDefault(
                            endVts.createCall(
                                endVts.createPropertyAccess(
                                    endVts.createIdentifier('San'),
                                    endVts.createIdentifier('defineComponent'),
                                ),
                                [
                                    endVts.createTypeReferenceNode(
                                        endVts.createIdentifier(uniqDataTypeName),
                                        undefined),
                                    endVts.createTypeReferenceNode(
                                        endVts.createIdentifier(uniqMethodTypeName),
                                        undefined),
                                ], // we will set our type arguments here
                                [
                                    endVts.createIdentifier(unicExportName)
                                ])
                        ));
                    return ts.visitEachChild(node, visit, context);
                }

                return node;
            }
            return ts.visitNode(rootNode, visit);
        }
    }

    const transformed = ts.transform(source, [modify]).transformed[0] as ts.SourceFile;

    source.statements = ts.setTextRange(ts.createNodeArray(transformed.statements), source.statements);
}
