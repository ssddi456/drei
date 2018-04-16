import * as path from 'path';
import * as ts from 'typescript';
import { forceReverseSlash } from './preprocess';
import { ComponentInfoProvider } from './findComponents';
import { getWrapperRangeSetter, createPropertySignature, createIdentifier, createTypeReferenceNode, createTypeQueryNode, createTypeAliasDeclaration, createTypeLiteralNode, createVariableStatement, createVariableDeclarationList, createVariableDeclaration, createPropertyAccess, createAsExpression, createParen, createObjectLiteral, createTypeParameterDeclaration, createConditionalTypeNode, createQualifiedName, createInferTypeNode, createKeywordTypeNode, createImportDeclaration, createNamespaceImport, createImportClause, createLiteral, createNamedImports, createImportSpecifier  } from './astHelper';

const insertedName = 'instance';
const computedTypeName = 'computedTypeName';

const DataTypeName = 'DataType';
const instanceDataTypeName = 'instanceDataType';

const OtherTypeNmae = 'OtherType';
const instanceOtherTypeName = 'instanceOtherType';

const instaceComputedObjectName = 'instanceComputedObject';



function getMemberKeys(objectType: ts.Type, checker: ts.TypeChecker): string[] {
    return objectType ? Array.from(checker.getPropertiesOfType(objectType).map(s => s.name)) : undefined;
}

export function insectComponentInfo(inforProvider: ComponentInfoProvider, derivedFromFile: string) {

    const checker = inforProvider.checker;
    const dataProperties = inforProvider ? inforProvider.getPropertyType('data') : undefined;
    // or the return type of initData
    const dataKeys = getMemberKeys(dataProperties, checker);

    const initDataMethodType = (inforProvider ? inforProvider.getPropertyType('initData') : undefined) as ts.ObjectType;
    const initDataReturnType = (initDataMethodType && (initDataMethodType.objectFlags & ts.ObjectFlags.Anonymous)) ?
        inforProvider.checker.getSignaturesOfType(initDataMethodType, ts.SignatureKind.Call)[0].getReturnType() : undefined;
    const initDataReturnKeys = getMemberKeys(initDataReturnType, checker);

    // get computed data type should get its return type
    const computedProperties = inforProvider ? inforProvider.getPropertyType('computed') : undefined;
    const computedKeys = getMemberKeys(computedProperties, checker);

    const filterProperties = inforProvider ? inforProvider.getPropertyType('filters') : undefined;
    const filterKeys = getMemberKeys(filterProperties, checker);

    const allMembers = checker ? checker.getPropertiesOfType(inforProvider.defaultExportType) : [];

    console.log('dataKeys', dataKeys);
    console.log('initDataReturnKeys', initDataReturnKeys);
    console.log('computedKeys', computedKeys);
    console.log('filterKeys', filterKeys);


    const allMemberFunctionKeys: string[] = [];
    for (let i = 0; i < allMembers.length; i++) {
        const symbol = allMembers[i];

        if (symbol.flags & ts.SymbolFlags.Method) {
            allMemberFunctionKeys.push(symbol.name);
        }
    }

    return function findInsertPoint<T extends ts.SourceFile>(context: ts.TransformationContext) {
        return function (rootNode: T) {
            console.log('do findInsertPoint', rootNode.fileName);

            const derivedFromFileRelativePath = './' + forceReverseSlash(path.relative(path.dirname(rootNode.fileName), derivedFromFile));
            console.log('derivedFromFileRelativePath', derivedFromFileRelativePath);

            let lastNoneIdentifierNodeKind: ts.SyntaxKind;
            let lastNodeKind: ts.SyntaxKind;

            function visit(node: ts.Node): ts.Node {
                console.log("Visiting " + ts.SyntaxKind[node.kind]);
                if (node.kind == ts.SyntaxKind.SourceFile) {
                    console.log('insert import dependance');

                    const file = node as ts.SourceFile;
                    const statements: Array<ts.Statement> = file.statements as any;

                    if (computedProperties) {
                        const members = computedKeys.map(x => {
                            return createPropertySignature(
                                undefined,
                                createIdentifier(x),
                                undefined,
                                createTypeReferenceNode(
                                    createIdentifier('ReturnType'),
                                    [createTypeQueryNode(
                                        createIdentifier(instaceComputedObjectName),
                                        createIdentifier(x))]
                                ),
                                undefined)
                        });
                        statements.unshift(
                            createTypeAliasDeclaration(
                                undefined,
                                undefined,
                                createIdentifier(computedTypeName),
                                undefined,
                                createTypeLiteralNode(members)
                            )
                        );

                        statements.unshift(
                            createVariableStatement(
                                undefined,
                                createVariableDeclarationList(
                                    [
                                        createVariableDeclaration(
                                            createIdentifier(instaceComputedObjectName),
                                            undefined,
                                            createPropertyAccess(
                                                createParen(
                                                    createAsExpression(
                                                        createObjectLiteral(),
                                                        createTypeReferenceNode(
                                                            createIdentifier(OtherTypeNmae),
                                                            undefined
                                                        )
                                                    )
                                                ),
                                                createIdentifier('computed'))
                                        )
                                    ],
                                    ts.NodeFlags.Const
                                )
                            )
                        );
                    }



                    statements.unshift(createTypeAliasDeclaration(
                        undefined,
                        undefined,
                        createIdentifier(instanceOtherTypeName),
                        undefined,
                        createTypeReferenceNode(
                            createIdentifier(OtherTypeNmae),
                            [createTypeQueryNode(
                                createIdentifier(insertedName)
                            )]
                        )
                    ));
                    statements.unshift(createTypeAliasDeclaration(
                        undefined,
                        undefined,
                        createIdentifier(instanceDataTypeName),
                        undefined,
                        createTypeReferenceNode(
                            createIdentifier(DataTypeName),
                            [createTypeQueryNode(
                                createIdentifier(insertedName)
                            )]
                        )
                    ));

                    statements.unshift(createTypeAliasDeclaration(
                        undefined,
                        undefined,
                        createIdentifier(DataTypeName),
                        [createTypeParameterDeclaration(
                            createIdentifier('T'),
                            undefined,
                            undefined,
                        )],
                        createConditionalTypeNode(
                            createTypeReferenceNode(
                                createIdentifier('T'),
                                undefined
                            ),
                            createTypeReferenceNode(
                                createQualifiedName(
                                    createIdentifier('San'),
                                    createIdentifier('ComponentConstructor')
                                ),
                                [createInferTypeNode(
                                    createTypeParameterDeclaration(
                                        createIdentifier('U'))),
                                createTypeLiteralNode([])]
                            ),
                            createTypeReferenceNode(
                                createIdentifier('U'),
                                undefined
                            ),
                            createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
                        )
                    ));

                    statements.unshift(createTypeAliasDeclaration(
                        undefined,
                        undefined,
                        createIdentifier(OtherTypeNmae),
                        [createTypeParameterDeclaration(
                            createIdentifier('T'),
                            undefined,
                            undefined,
                        )],
                        createConditionalTypeNode(
                            createTypeReferenceNode(
                                createIdentifier('T'),
                                undefined
                            ),
                            createTypeReferenceNode(
                                createQualifiedName(
                                    createIdentifier('San'),
                                    createIdentifier('ComponentConstructor')
                                ),
                                [
                                    createTypeLiteralNode([]),
                                    createInferTypeNode(
                                        createTypeParameterDeclaration(
                                            createIdentifier('U'))),
                                ]
                            ),
                            createTypeReferenceNode(
                                createIdentifier('U'),
                                undefined
                            ),
                            createKeywordTypeNode(ts.SyntaxKind.NeverKeyword)
                        )
                    ));

                    statements.unshift(createImportDeclaration(
                        undefined,
                        undefined,
                        createImportClause(undefined,
                            createNamespaceImport(
                                createIdentifier('San')
                            )),
                        createLiteral('san')
                    ));

                    statements.unshift(
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
                }

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
                    console.log((node as ts.Identifier).escapedText);

                    if (lastNodeKind !== ts.SyntaxKind.Identifier
                        || lastNoneIdentifierNodeKind !== ts.SyntaxKind.PropertyAccessExpression
                    ) {
                        const propertyNode = node as ts.Identifier;
                        const propertyName = propertyNode.escapedText as string;

                        console.log('insert instance identifier', propertyNode.escapedText);
                        let insertNode: ts.Expression;
                        const setStartPos = getWrapperRangeSetter({ pos: node.pos, end: node.pos + 1 });

                        if ((dataKeys && dataKeys.includes(propertyName))
                            || (initDataReturnKeys && initDataReturnKeys.includes(propertyName))
                        ) {
                            insertNode = ts.createParen(
                                setStartPos(ts.createAsExpression(
                                    setStartPos(ts.createObjectLiteral(undefined, false)),
                                    setStartPos(ts.createTypeReferenceNode(
                                        setStartPos(ts.createIdentifier(instanceDataTypeName)), undefined))
                                )));
                        } else if (computedKeys && computedKeys.includes(propertyName)) {
                            insertNode = ts.createParen(
                                setStartPos(ts.createAsExpression(
                                    setStartPos(ts.createObjectLiteral(undefined, false)),
                                    setStartPos(ts.createTypeReferenceNode(
                                        setStartPos(ts.createIdentifier(computedTypeName)), undefined))
                                )));
                        } else {
                            // others
                            insertNode = ts.createIdentifier(insertedName);
                        }

                        const propAccess = ts.setTextRange(
                            ts.createPropertyAccess(
                                setStartPos(insertNode),
                                node as ts.Identifier
                            ),
                            node);

                        lastNodeKind = node.kind;
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
