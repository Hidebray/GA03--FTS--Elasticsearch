import express from "express";
import * as productController from "../controllers/product.controller.js"

const productRouter = express.Router();

productRouter.get("/", productController.getAll);
productRouter.get("/:id", productController.getOne);
productRouter.get("/suggest", productController.suggest);

export default productRouter;