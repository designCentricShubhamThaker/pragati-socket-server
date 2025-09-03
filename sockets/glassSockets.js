import fetch from "node-fetch";import { getTeamsToNotify } from "../utils/DecorationSequence.js";
;

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

  // Add this socket handler to your glassSockets.js file
  socket.on("updateGlassVehicle", async (payload) => {
    const { order_number, item_id, component_id, updateData } = payload;

    try {
      console.log("🚛 [Socket] Glass vehicle update received:", payload);

      const vehicleRes = await fetch(
        `https://doms-k1fi.onrender.com/api/masters/glass/vehicle/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData), // Send the updateData directly which contains vehicle_details array
        }
      );

      const vehicleResponse = await vehicleRes.json();
      console.log(vehicleResponse);

      if (!vehicleRes.ok || !vehicleResponse.success) {
        throw new Error(vehicleResponse.message || "Vehicle update failed");
      }

      const updatedComponent = {
        component_id: component_id,
        vehicle_details: vehicleResponse.data
      };

      console.log("🔧 [Socket] Formatted component for frontend:", updatedComponent);

      socket.emit("glassVehicleUpdatedSelf", {
        order_number,
        item_id,
        component_id,
        updatedComponent
      });

      io.to("glass").emit("glassVehicleUpdated", {
        order_number,
        item_id,
        component_id,
        updatedComponent
      });

    } catch (err) {
      console.error("❌ [Socket] Glass vehicle update error:", err.message);
      socket.emit("glassVehicleError", err.message);
    }
  });

  socket.on("dispatchGlassComponent", async (payload) => {
    const { order_number, item_id, component_id, updateData } = payload;

    try {
      console.log("📦 [Socket] Order dispatch request received:", payload);

      const dispatchRes = await fetch(
        `https://doms-k1fi.onrender.com/api/masters/glass/dispatch/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        }
      );

      const dispatchResponse = await dispatchRes.json();
      console.log(dispatchResponse);

      if (!dispatchRes.ok || !dispatchResponse.success) {
        throw new Error(dispatchResponse.message || "Dispatch failed");
      }

      const comp = dispatchResponse?.data?.component;
      const itemStatus = dispatchResponse?.data?.item_status;
      const orderStatus = dispatchResponse?.data?.order_status;

      const updatedComponent = {
        component_id: comp?.component_id,
        name: comp?.name,
        status: comp?.status,
        dispatch_date: comp?.dispatch_date,
        dispatched_by: comp?.dispatched_by,
        tracking: []
      };
      
      const itemChanges = {
        item_id,
        new_status: itemStatus,
      };

      const orderChanges = {
        order_number,
        new_status: orderStatus,
      };

      socket.emit("glassDispatchUpdatedSelf", {
        order_number,
        item_id,
        component_id,
        updatedComponent,
        itemChanges,
        orderChanges
      });

      io.to("glass").emit("glassDispatchUpdated", {
        order_number,
        item_id,
        component_id,
        updatedComponent,
        itemChanges,
        orderChanges
      });

      // NEW: Notify next team in decoration sequence
      if (comp?.deco_sequence) {
        const teamsToNotify = getTeamsToNotify(comp.deco_sequence, 'glass');
        console.log(`🔔 [Socket] Notifying teams: ${teamsToNotify.join(', ')}`);
        
        teamsToNotify.forEach(team => {
          io.to(team).emit("decorationTeamNotification", {
            type: "READY_FOR_WORK",
            message: `Glass component ${comp.name} is ready for ${team} work`,
            order_number,
            item_id,
            component_id,
            component_name: comp.name,
            previous_team: 'glass',
            current_team: team
          });
        });
      }

    } catch (err) {
      console.error("❌ [Socket] Order dispatch error:", err.message);
      socket.emit("orderDispatchError", err.message);
    }
  });

  // Handle decoration team production updates (printing, coating, foiling, frosting)
  socket.on("updateDecorationProduction", async (payload) => {
    const { team, order_number, item_id, component_id, updateData } = payload;

    try {
      console.log(`🎨 [Socket] ${team} production update received:`, payload);

      const response = await fetch(
        `https://doms-k1fi.onrender.com/api/deco/production/${team}/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        }
      );

      const result = await response.json();
      console.log(`🎨 [Socket] ${team} API Response:`, result);

      if (!response.ok || !result.success) {
        throw new Error(result.message || `${team} production update failed`);
      }

      const updatedComponent = result?.data;
  
      socket.emit(`${team}ProductionUpdatedSelf`, { 
        order_number, 
        item_id, 
        component_id, 
        updatedComponent 
      });

      io.to(team).emit(`${team}ProductionUpdated`, { 
        order_number, 
        item_id, 
        component_id, 
        updatedComponent 
      });

      console.log(`✅ [Socket] ${team} production update successful`);

    } catch (err) {
      console.error(`❌ [Socket] ${team} production update error:`, err.message);
      socket.emit(`${team}ProductionError`, err.message);
    }
  });

  // Handle decoration team dispatch
  socket.on("dispatchDecorationComponent", async (payload) => {
    const { team, order_number, item_id, component_id, updateData } = payload;

    try {
      console.log(`📦 [Socket] ${team} dispatch request received:`, payload);

      const dispatchRes = await fetch(
        `https://doms-k1fi.onrender.com/api/deco/dispatch/${team}/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        }
      );

      const dispatchResponse = await dispatchRes.json();
      console.log(dispatchResponse);

      if (!dispatchRes.ok || !dispatchResponse.success) {
        throw new Error(dispatchResponse.message || `${team} dispatch failed`);
      }

      const comp = dispatchResponse?.data?.component;
      const itemStatus = dispatchResponse?.data?.item_status;
      const orderStatus = dispatchResponse?.data?.order_status;

      const updatedComponent = {
        component_id: comp?.component_id,
        name: comp?.name,
        decorations: comp?.decorations,
        dispatch_date: comp?.decorations?.[team]?.dispatch_date,
        dispatched_by: comp?.decorations?.[team]?.dispatched_by,
      };
      
      const itemChanges = {
        item_id,
        new_status: itemStatus,
      };

      const orderChanges = {
        order_number,
        new_status: orderStatus,
      };

      socket.emit(`${team}DispatchUpdatedSelf`, {
        order_number,
        item_id,
        component_id,
        updatedComponent,
        itemChanges,
        orderChanges
      });

      io.to(team).emit(`${team}DispatchUpdated`, {
        order_number,
        item_id,
        component_id,
        updatedComponent,
        itemChanges,
        orderChanges
      });

      // NEW: Notify next team in decoration sequence
      if (comp?.deco_sequence) {
        const teamsToNotify = getTeamsToNotify(comp.deco_sequence, team);
        console.log(`🔔 [Socket] Notifying teams after ${team}: ${teamsToNotify.join(', ')}`);
        
        teamsToNotify.forEach(nextTeam => {
          io.to(nextTeam).emit("decorationTeamNotification", {
            type: "READY_FOR_WORK",
            message: `Component ${comp.name} is ready for ${nextTeam} work`,
            order_number,
            item_id,
            component_id,
            component_name: comp.name,
            previous_team: team,
            current_team: nextTeam
          });
        });
      }

    } catch (err) {
      console.error(`❌ [Socket] ${team} dispatch error:`, err.message);
      socket.emit(`${team}DispatchError`, err.message);
    }
  });

  // Rest of your existing handlers...
  socket.on("rollbackGlassProduction", async (payload) => {
    const { order_number, item_id, component_id, updateData, component_data_code } = payload;

    try {
      console.log("🔄 [Socket] Glass rollback request received:", payload);

      const vehicleRes = await fetch(
        `https://doms-k1fi.onrender.com/api/masters/glass/vehicle/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vehicle_details: [] }),
        }
      );

      const vehicleResponse = await vehicleRes.json();
      console.log("🚛 [Socket] Vehicle clearing response:", vehicleResponse);

      if (!vehicleRes.ok || !vehicleResponse.success) {
        throw new Error(vehicleResponse.message || "Vehicle clearing failed");
      }

      const clearedComponent = {
        component_id: component_id,
        vehicle_details: [] 
      };

      socket.emit("glassVehicleUpdatedSelf", {
        order_number,
        item_id,
        component_id,
        updatedComponent: clearedComponent
      });

      io.to("glass").emit("glassVehicleUpdated", {
        order_number,
        item_id,
        component_id,
        updatedComponent: clearedComponent
      });

      console.log("✅ [Socket] Vehicle details cleared, proceeding with rollback...");

      const res = await fetch(
        `https://doms-k1fi.onrender.com/api/orders/rollback/component/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        }
      );

      const response = await res.json();
      console.log("🔄 [Socket] Rollback API response:", response);

      if (!res.ok || !response.success) {
        throw new Error(response.message || "Rollback failed");
      }

      const componentChanges = response?.data?.component_changes;
      const itemChanges = response?.data?.item_changes;
      const orderChanges = response?.data?.order_changes;

      const updatedComponent = {
        component_id: componentChanges?.component_id,
        name: componentChanges?.component_name,
        component_type: componentChanges?.component_type,
        status: componentChanges?.new_status,
        completed_qty: componentChanges?.new_completed_qty,
        tracking: [],
        vehicle_details: []
      };

      socket.emit("glassRollbackUpdatedSelf", {
        order_number,
        item_id,
        component_id,
        updatedComponent,
        itemChanges,
        orderChanges
      });

      io.to("glass").emit("glassRollbackUpdated", {
        order_number,
        item_id,
        component_id,
        updatedComponent,
        itemChanges,
        orderChanges
      });

      if (updateData.quantity_to_rollback > 0) {
        console.log("📦 [Socket] Adjusting stock...");

        const stockRes = await fetch(
          `https://doms-k1fi.onrender.com/api/masters/glass/stock/adjust/${component_data_code}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adjustment: updateData.quantity_to_rollback }),
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

        io.to("glass").emit("glassStockAdjusted", {
          dataCode: updatedGlass?.data_code,
          newStock: updatedGlass?.available_stock,
        });

        console.log("✅ [Socket] Stock adjusted successfully");
      }

      console.log("✅ [Socket] Glass rollback completed successfully");

    } catch (err) {
      console.error("❌ [Socket] Glass rollback error:", err.message);
      socket.emit("glassRollbackError", { message: err.message });
    }
  });

  socket.on("negativeAdjustmentGlassComponent", async (payload) => {
    const { order_number, item_id, component_id, updateData } = payload;

    try {
      console.log("⚙️ [Socket] glass negative adjustment received:", payload);
      if (!order_number || !item_id || !component_id || !updateData) {
        throw new Error("Missing required parameters for negative adjustment");
      }

      if (!updateData.reason || updateData.reason.trim() === '') {
        throw new Error("Reason is required for negative adjustment");
      }

      const res = await fetch(
        `https://doms-k1fi.onrender.com/api/masters/glass/production/adjust-negative/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            adjustment: Number(updateData.quantity_to_remove),
            username: updateData.username || "glass_admin",
            reason: updateData.reason,
          }),
        }
      );

      const response = await res.json();
      if (!res.ok || !response.success) {
        throw new Error(response.message || "Negative adjustment failed");
      }

      console.log("✅ [API] Negative adjustment successful:", response.data);

      const comp = response?.data?.component;
      const adjustmentSummary = response?.data?.adjustment_summary;
      const orderStatus = response?.data?.order_status;

      const updatedComponent = {
        component_id: comp?.component_id,
        name: comp?.name,
        status: comp?.status,
        completed_qty: comp?.completed_qty,
        ordered_qty: comp?.ordered_qty,
        remaining_qty: comp?.remaining_qty,
        tracking: comp?.tracking || response?.data?.tracking || []
      };

      const itemChanges = {
        item_id,
        new_status: comp?.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS",
      };

      const orderChanges = {
        order_number,
        new_status: orderStatus,
      };

      socket.emit("glassNegativeAdjustmentUpdatedSelf", {
        order_number,
        item_id,
        component_id,
        updatedComponent,
        adjustmentSummary: {
          total_removed: adjustmentSummary?.total_removed,
          removed_from_stock: adjustmentSummary?.removed_from_stock,
          removed_from_produced: adjustmentSummary?.removed_from_produced,
          previous_completed: adjustmentSummary?.previous_completed,
          current_completed: adjustmentSummary?.current_completed,
          username: adjustmentSummary?.username,
          reason: adjustmentSummary?.reason
        },
        itemChanges,
        orderChanges
      });

      io.to("glass").emit("glassNegativeAdjustmentUpdated", {
        order_number,
        item_id,
        component_id,
        updatedComponent,
        adjustmentSummary: {
          total_removed: adjustmentSummary?.total_removed,
          removed_from_stock: adjustmentSummary?.removed_from_stock,
          removed_from_produced: adjustmentSummary?.removed_from_produced,
          previous_completed: adjustmentSummary?.previous_completed,
          current_completed: adjustmentSummary?.current_completed,
          username: adjustmentSummary?.username,
          reason: adjustmentSummary?.reason
        },
        itemChanges,
        orderChanges
      });

      console.log("📢 [Socket] Negative adjustment broadcasted successfully");

    } catch (err) {
      console.error("❌ [Socket] glass negative adjustment error:", err.message);

      socket.emit("glassNegativeAdjustmentError", { 
        message: err.message || "Negative adjustment operation failed"
      });
    }
  });

}