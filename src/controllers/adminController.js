import * as adminService from "../services/adminService.js";

export const adminImportCollocations = async (req, res) => {
  try {
    const result = await adminService.bulkInsertCollocations(req.body?.collocationsList || []);
    return res.status(200).json({
      success: true,
      message: "Collocations imported successfully",
      ...result,
    });
  } catch (error) {
    console.error("adminImportCollocations failed:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to import collocations",
    });
  }
};