import { Client } from "@elastic/elasticsearch";
import { faker } from "@faker-js/faker";

export const client = new Client ({
  node: process.env.ELASTICSEARCH_URL||'http://localhost:9200',
});

const INDEX_NAME = "products";
const DOC_COUNT = 10000;

const createData = async () => {
  try {
    // check if index exists
    console.log(`Checking if index "${INDEX_NAME}" exists...`);
    const indexExists = await client.indices.exists({ index: INDEX_NAME});
    if (indexExists) {
      console.log(`Index "${INDEX_NAME}" exists.Deleting...`)
      await client.indices.delete({ index: INDEX_NAME})
    }

    // create index with mappings
    console.log(`Creating index "${INDEX_NAME}" with mappings...`);
    await client.indices.create({
      index: INDEX_NAME,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
        },
        mappings: {
          properties: {
            title: { type: "search_as_you_type" },
            description: { type: "text" },
            category: { type: "keyword" },
          }
        }
      }
    });

    // generate fake data
    console.log(`Generating ${DOC_COUNT} fake product documents...`);
    const data = [];
    faker.seed(1234); // constistent data generation
    for (let i = 0; i < DOC_COUNT; i++) {
      data.push({
        title: faker.commerce.productName(),
        description: faker.commerce.productDescription(),
        category: faker.commerce.department(),
      });
    }

    // bulk indexing for better performance
    console.log(`Indexing documents in bulk...`);
    const body = data.flatMap(doc => [{ index: { _index: INDEX_NAME}}, doc]);
    const bulkResponse = await client.bulk({ refresh: true, body});

    if (bulkResponse.errors) {
      const erroredDocuments = [];
      bulkResponse.items.forEach((action, i) => {
        const operation = Object.keys(action)[0];
        if (action[operation].error) {
          erroredDocuments.push({
            status: action[operation].status,
            error: action[operation].error,
            operation: body[i * 2],
            document: body[i * 2 + 1]
          });
        }
      });
      console.error('Errors encountered during bulk indexing:', erroredDocuments);
    } else {
      console.log(`Successfully indexed ${DOC_COUNT} documents.`);
    }
    
  } catch (error) {
    console.error("Error creating data:", error);
  }
};

export default createData;