import * as productService from "../services/product.service.js"

export const getAll = async (req, res) => {
  const { query } = req.query;
  if (!query) {
    return res.status(400).json({ message: "Query parameter is required"});
  }

  try {
    const startTime = Date.now();

    const { hits, total } = await productService.getAll(query);
    res.json({
      time: Date.now() - startTime,
      total,
      hits,
    });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ message: "Error fetching products"});
  }
}

export const getOne = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ message: "Product ID is required" });
  }

  try {
    const startTime = Date.now();
    const data = await productService.getOne(id);
    res.json({
      time: Date.now() - startTime,
      data,
    })

  } catch (error) {
    console.error("Error fetching product:", error);
    res.status(500).json({ message: "Error fetching product"});
  }
}

export const suggest = async (req, res) => {
  const { query } = req.query;

  if (!query) {
    return res.status(400).json({ message: "Query parameter is required" });
  }

  try {
    const startTime = Date.now();
    const suggestions = await productService.suggest(query);
    res.json({
      time: Date.now() - startTime,
      suggestions,
    });
  } catch (error) {
    console.error("Error fetching product suggestions:", error);
    res.status(500).json({ message: "Error fetching product suggestions"});
  }
}