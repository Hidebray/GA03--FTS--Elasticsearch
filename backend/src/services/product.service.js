import client from "../config/elasticsearch.js";

const INDEX_NAME = "products";

export const getAll = async (query) => {
  const data = await client.search({
    index: INDEX_NAME,
    request_cache: false,
    body: {
      query: {
        multi_match: {
          query: query,
          fields: ["title^3", "description"],
          fuzziness: "AUTO",
        }
      },
      highlight: {
        pre_tags: ['<em class="highlight">'],
        post_tags: ['</em>'],
        fields: {
          title: {},
          description: {},
        }
      }
    }
  });

  const hits = data.hits.hits.map(hit => ({
    id: hit._id,
    ...hit._source,
    highlights: hit.highlight || {},
  }));

  return {
    total: data.hits.total.value,
    hits,
  };
};


export const getOne = async (id) => {
  const data = await client.get({
    index: INDEX_NAME,
    id,
  });

  return {
    id: data._id,
    ...data._source,
  };
};

export const suggest = async (query) => {
  const data = await client.search({
    index: INDEX_NAME,
    request_cache: false,
    body: {
      query: {
        multi_match: {
          query: query,
          type: "bool_prefix",
          fields: ["title", "title._2gram", "title._3gram"],
        }
      },
      size: 7,
      _source: ["title"],
    }
  });
  
  const suggestions = data.hits.hits.map(hit => hit._source.title);

  return [...new Set(suggestions)];
};