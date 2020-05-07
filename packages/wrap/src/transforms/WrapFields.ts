import { GraphQLSchema, GraphQLObjectType } from 'graphql';

import { Transform, Request, hoistFieldNodes, getFields, modifyFields, createNamedStub } from '@graphql-tools/utils';
import { createMergedResolver, defaultMergedResolver } from '@graphql-tools/delegate';

import MapFields from './MapFields';

export default class WrapFields implements Transform {
  private readonly outerTypeName: string;
  private readonly wrappingFieldNames: Array<string>;
  private readonly wrappingTypeNames: Array<string>;
  private readonly numWraps: number;
  private readonly fieldNames: Array<string>;
  private readonly transformer: Transform;

  constructor(
    outerTypeName: string,
    wrappingFieldNames: Array<string>,
    wrappingTypeNames: Array<string>,
    fieldNames?: Array<string>
  ) {
    this.outerTypeName = outerTypeName;
    this.wrappingFieldNames = wrappingFieldNames;
    this.wrappingTypeNames = wrappingTypeNames;
    this.numWraps = wrappingFieldNames.length;
    this.fieldNames = fieldNames;

    const remainingWrappingFieldNames = this.wrappingFieldNames.slice();
    const outerMostWrappingFieldName = remainingWrappingFieldNames.shift();
    this.transformer = new MapFields({
      [outerTypeName]: {
        [outerMostWrappingFieldName]: (fieldNode, fragments) =>
          hoistFieldNodes({
            fieldNode,
            path: remainingWrappingFieldNames,
            fieldNames: this.fieldNames,
            fragments,
          }),
      },
    });
  }

  public transformSchema(schema: GraphQLSchema): GraphQLSchema {
    const targetFieldConfigMap = getFields(
      schema,
      this.outerTypeName,
      !this.fieldNames ? () => true : fieldName => this.fieldNames.includes(fieldName)
    );

    const innerMostFieldNames = Object.keys(targetFieldConfigMap);

    const remove = [
      {
        typeName: this.outerTypeName,
        testFn: (fieldName: string) => innerMostFieldNames.includes(fieldName),
      },
    ];

    let wrapIndex = this.numWraps - 1;

    const innerMostWrappingTypeName = this.wrappingTypeNames[wrapIndex];
    const append = [
      {
        typeName: innerMostWrappingTypeName,
        additionalFields: targetFieldConfigMap,
      },
    ];

    for (wrapIndex--; wrapIndex > -1; wrapIndex--) {
      append.push({
        typeName: this.wrappingTypeNames[wrapIndex],
        additionalFields: {
          [this.wrappingFieldNames[wrapIndex + 1]]: {
            type: createNamedStub(this.wrappingTypeNames[wrapIndex + 1], 'object') as GraphQLObjectType,
            resolve: defaultMergedResolver,
          },
        },
      });
    }

    append.push({
      typeName: this.outerTypeName,
      additionalFields: {
        [this.wrappingFieldNames[0]]: {
          type: createNamedStub(this.wrappingTypeNames[0], 'object') as GraphQLObjectType,
          resolve: createMergedResolver({ dehoist: true }),
        },
      },
    });

    const newSchema = modifyFields(schema, { append, remove });

    return this.transformer.transformSchema(newSchema);
  }

  public transformRequest(originalRequest: Request): Request {
    return this.transformer.transformRequest(originalRequest);
  }
}