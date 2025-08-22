import fetch from "node-fetch";

const username = "glass_admin";

export default function glassSockets(io, socket) {

  socket.on("joinGlass", () => {
    socket.join("glass");
    console.log(`[JOIN] Client ${socket.id} joined room: glass`);
    socket.emit("joinedGlass", { message: "You have joined the glass room" });
  });

  // Handle glass stock update
  socket.on("updateGlassStock", async ({ data_code, adjustment }) => {
    console.log(`[REQ] Client ${socket.id} requested stock update`, { data_code, adjustment });

    try {
      const response = await fetch(
        `https://doms-k1fi.onrender.com/api/masters/glass/stock/adjust/${data_code}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ adjustment, username }),
        }
      );

      if (!response.ok) {
        console.error(`[ERR] API failed with status: ${response.status}`);
        throw new Error(`Failed to update glass stock: ${response.statusText}`);
      }

      console.log(response, "response");
      const updatedGlass = await response.json();
      console.log(updatedGlass, "updated glass");
      const newStock = updatedGlass?.data?.available_stock;

      console.log(`[SUCCESS] Stock updated for ${data_code}, newStock=${newStock}`);

      socket.emit("glassStockUpdatedSelf", {
        data_code,
        newStock,
        message: "Stock updated successfully",
      });
      io.to("glass").emit("glassStockUpdated", {
        data_code,
        newStock,
      });

    } catch (error) {
      console.error(`[ERROR] Glass stock update error: ${error.message}`);
      socket.emit("errorMessage", { message: error.message });
    }
  });

  socket.on("addGlass", async (newGlassData) => {
    try {
      console.log("➕ [Socket] Add Glass request received", newGlassData);
      const response = await fetch(`https://doms-k1fi.onrender.com/api/masters/glass`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...newGlassData, username }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[Socket] Add Glass API failed:", errText);
        socket.emit("glassAddError", errText || "Failed to add glass product");
        return;
      }

      const data = await response.json();
      const createdGlass = data?.data;

      console.log("✅ [Socket] Glass created via API:", createdGlass);
      socket.emit("glassAddedSelf", createdGlass);
      io.to("glass").emit("glassAdded", createdGlass);

    } catch (err) {
      console.error("❌ [Socket] Add Glass error:", err.message);
      socket.emit("glassAddError", err.message);
    }
  });

  socket.on("updateGlass", async ({ productId, updateData }) => {
    try {
      console.log("✏️ [Socket] Update Glass request", productId, updateData);
      const response = await fetch(`https://doms-k1fi.onrender.com/api/masters/glass/${productId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...updateData, username }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error("[Socket] Update Glass API failed:", errText);
        socket.emit("glassUpdateError", errText || "Failed to update glass product");
        return;
      }
      const data = await response.json();
      const updatedGlass = data?.data;
      console.log("✅ [Socket] Glass updated via API:", updatedGlass);
      socket.emit("glassUpdatedSelf", updatedGlass);
      io.to("glass").emit("glassUpdated", updatedGlass);

    } catch (err) {
      console.error("❌ [Socket] Update Glass error:", err.message);
      socket.emit("glassUpdateError", err.message);
    }
  });

  socket.on("deleteGlass", async ({ productId }) => {
    try {
      console.log(`🗑️ [Socket] Delete request received for glassId: ${productId}`);

      // Call your existing API
      const response = await fetch(
        `https://doms-k1fi.onrender.com/api/masters/glass/${productId}`,
        {
          method: "DELETE",
        }
      );

      if (response.ok) {
        console.log(`✅ [Socket] Glass ${productId} deleted via API`);

        // ✅ Emit back only to the requester (acknowledgement)
        socket.emit("glassDeletedSelf", {
          productId,
          message: "Glass deleted successfully",
        });

        // ✅ Broadcast to all glass room clients (including sender if joined)
        io.to("glass").emit("glassDeleted", { productId });
      } else {
        console.warn(`⚠️ [Socket] Failed to delete glass ${productId}`);
        const errText = await response.text();
        socket.emit("glassDeleteError", errText || "Failed to delete glass product");
      }
    } catch (err) {
      console.error("❌ [Socket] Delete error:", err.message);
      socket.emit("glassDeleteError", err.message);
    }
  });

  socket.on("updateGlassProduction", async (payload) => {
    const { order_number, item_id, component_id, updateData, component_data_code } = payload;

    try {
      console.log("⚙️ [Socket] Glass production update received:", payload);

      // 1. Call API (or DB update directly)
      const glassRes = await fetch(
        `https://doms-k1fi.onrender.com/api/masters/glass/production/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...updateData, username }),
        }
      );
      const glassResponse = await glassRes.json();
      console.log(glassResponse)
      if (!glassRes.ok || !glassResponse.success) {
        throw new Error(glassResponse.message || "Glass update failed");
      }

      const updatedComponent = glassResponse?.data?.component;
      socket.emit("glassProductionUpdatedSelf", { order_number, item_id, component_id, updatedComponent });

      io.to("glass").emit("glassProductionUpdated", { order_number, item_id, component_id, updatedComponent });

      if (updateData.stock_used > 0) {
        const adjustmentValue = -(updateData.stock_used);

        const stockRes = await fetch(
          `https://doms-k1fi.onrender.com/api/masters/glass/stock/adjust/${component_data_code}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adjustment: adjustmentValue }),
          }
        );
        const stockResponse = await stockRes.json();
        if (!stockRes.ok || !stockResponse.success) {
          throw new Error(stockResponse.message || "Stock adjustment failed");
        }

        const updatedGlass = stockResponse?.data;
        socket.emit("glassStockAdjustedSelf", {
          dataCode: updatedGlass?.data_code,
          newStock: updatedGlass?.available_stock,
        });

        socket.broadcast.emit("glassStockAdjusted", {
          dataCode: updatedGlass?.data_code,
          newStock: updatedGlass?.available_stock,
        });
      }
    } catch (err) {
      console.error("❌ [Socket] Glass update error:", err.message);
      socket.emit("glassProductionError", err.message);
    }
  });
}