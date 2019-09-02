import { warn } from '@ember/debug';
import { ApiStatus } from '@datahub/utils/api/shared';
import { getJSON, putJSON } from '@datahub/utils/api/fetcher';
import { datasetUrlById, datasetUrlByUrn } from 'wherehows-web/utils/api/datasets/shared';
import {
  IDatasetProperties,
  IDatasetPropertiesGetResponse,
  IDatasetPinotPropertiesGetResponse,
  IDatasetPinotProperties
} from 'wherehows-web/typings/api/datasets/properties';

/**
 * Describes the interface for an element in the list generated by the buildPropertiesList function
 * @interface IPropertyItem
 */
interface IPropertyItem {
  isSelectController: boolean;
  key: keyof IDatasetProperties;
  value: string | Element;
}

/**
 * Constructs the dataset properties endpoint url based on the id
 * @param {number} id dataset id
 */
const datasetPropertiesUrlById = (id: number): string => `${datasetUrlById(id)}/properties`;

/**
 * Returns the url for a dataset deprecation endpoint by urn
 * @param {string} urn
 * @return {string}
 */
const datasetDeprecationUrlByUrn = (urn: string): string => `${datasetUrlByUrn(urn)}/deprecate`;

/**
 * Reads the response from the dataset properties endpoint and returns properties if found
 * @param {number} id the dataset id to get properties for
 * @returns {IDatasetPropertiesGetResponse | IDatasetPinotPropertiesGetResponse}
 */
const readDatasetProperties = async <T extends IDatasetPropertiesGetResponse | IDatasetPinotPropertiesGetResponse>(
  id: number
): Promise<IDatasetProperties> => {
  const { status, properties, message } = await getJSON<T>({ url: datasetPropertiesUrlById(id) });

  if (status === ApiStatus.OK && properties) {
    return properties;
  }

  // treat the error status with a record not found msg as empty set
  if (status === ApiStatus.ERROR && message === 'record not found') {
    return {};
  }

  throw new Error('Exception occurred reading the dataset properties');
};

/**
 * Formats the property value as a date string
 * @param {keyof IDatasetProperties} property
 * @param {*} value
 * @returns {*}
 */
//TODO
// eslint-disable-next-line
const formatPropertyDateValue = (property: Extract<keyof IDatasetProperties, string>, value: any): any => {
  const isoStringDateProperties = ['modification_time', 'begin_date', 'lumos_process_time', 'end_date', 'oracle_time'];

  if (isoStringDateProperties.includes(property)) {
    if (+value < 0) {
      return value;
    }

    try {
      return new Date(value).toISOString();
    } catch (e) {
      warn(`Property ${property} has an unexpected value ${value}`);
      throw e;
    }
  }

  if (property === 'dumpdate') {
    return [['-', 0, 4], ['-', 4, 6], [' ', 6, 8], [':', 8, 10], [':', 10, 12], ['', 12, 14]].reduce(
      (dateString, props: [string, number, number]): string => {
        const [postfix, start, end] = props;
        return value ? dateString + ('' + value).substring(start, end) + postfix : dateString;
      },
      ''
    );
  }

  return value;
};

/**
 * Builds a list of IPropertyItem values
 * @param {IDatasetProperties} properties
 * @returns {Array<IPropertyItem>}
 * @link IPropertyItem
 */
const buildPropertiesList = (properties: IDatasetProperties): Array<IPropertyItem> => {
  return Object.keys(properties).reduce((propertiesList, property: Extract<keyof IDatasetProperties, string>) => {
    if (['elements', 'view_depends_on'].includes(property)) {
      return propertiesList;
    }

    const typeofPropertyIsNotObject = typeof properties[property] !== 'object';
    const connectionURL = properties['connectionURL'];
    let value: string | Element;
    let listItem: IPropertyItem = {
      isSelectController: ['view_expanded_text', 'viewSqlText'].includes(property),
      key: property,
      value: window.JsonHuman ? window.JsonHuman.format(properties[property]) : ''
    };

    if (typeofPropertyIsNotObject) {
      if (connectionURL) {
        const list = connectionURL.split(',') || [];
        value = list.length ? (window.JsonHuman ? window.JsonHuman.format(list) : '') : connectionURL;
      } else {
        const tempValue = formatPropertyDateValue(property, properties[property]);
        value = !tempValue && tempValue !== 0 ? 'NULL' : tempValue;
      }

      listItem = { ...listItem, value };
    }

    return [...propertiesList, listItem];
  }, []);
};

/**
 * Reads the dataset properties returned by the properties endpoint and builds a list of IPropertyItem values
 * @param {number} id
 * @returns {Promise<Array<IPropertyItem>>}
 */
const readNonPinotProperties = async (id: number): Promise<Array<IPropertyItem>> => {
  try {
    return buildPropertiesList((await readDatasetProperties(id)) as IDatasetProperties);
  } catch (e) {
    warn('Exception occurred building the properties list for non pinot properties');
    throw e;
  }
};

/**
 * Describes the interface of object returned from the api request to get pinot properties
 * @interface IDatasetSamplesAndColumns
 */
interface IDatasetSamplesAndColumns {
  hasSamples: boolean;
  samples: Array<string>;
  columns: Array<string>;
}
/**
 * Extracts samples and columns for a dataset that is sourced from pinot
 * @param {IDatasetPinotProperties} [properties=<IDatasetPinotProperties>{}]
 * @returns
 */
const getDatasetSamplesAndColumns = (
  //TODO
  // eslint-disable-next-line
  properties: IDatasetPinotProperties = {} as IDatasetPinotProperties
): IDatasetSamplesAndColumns | void => {
  const { elements = [{ columnNames: [], results: [] }] } = properties;
  const [{ columnNames = [], results }] = elements;
  if (columnNames.length) {
    return {
      hasSamples: true, // TODO: remove the, can be derived from samples.length
      samples: results,
      columns: columnNames
    };
  }
};

/**
 * Reads a subset: samples and columns from a datasets properties that are derived from pinot
 * @param {number} id the id of the pinot dataset
 * @returns
 */
const readPinotProperties = async (id: number): Promise<void | IDatasetSamplesAndColumns> => {
  try {
    return getDatasetSamplesAndColumns((await readDatasetProperties(id)) as IDatasetPinotProperties);
  } catch (e) {
    warn('Exception occurred building the samples and columns for pinot properties');
    throw e;
  }
};

/**
 * Persists the changes to a datasets deprecation properties by urn
 * @param {string} urn
 * @param {boolean} deprecated
 * @param {string} deprecationNote
 * @param {Date | null} decommissionTime
 * @return {Promise<void>}
 */
const updateDatasetDeprecationByUrn = (
  urn: string,
  deprecated: boolean,
  deprecationNote: string = '',
  decommissionTime: number | null
): Promise<void> =>
  putJSON<void>({
    url: datasetDeprecationUrlByUrn(urn),
    data: {
      deprecated,
      deprecationNote,
      decommissionTime
    }
  });

export { readDatasetProperties, readNonPinotProperties, readPinotProperties, updateDatasetDeprecationByUrn };