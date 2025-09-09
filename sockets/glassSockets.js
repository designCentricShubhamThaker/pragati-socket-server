import fetch from "node-fetch";
import { parseDecorationSequence } from "../utils/DecorationSequence.js";

const username = "glass_admin";

export default function glassSockets(io, socket) {

  // Single room for all production communication
  socket.on("joinProduction", () => {
    socket.join("production");
    console.log(`[JOIN] Client ${socket.id} joined production room`);
    socket.emit("joinedProduction", { message: "You have joined the production room" });
  });

socket.on("dispatchGlassComponent", async (payload) => {
  const { order_number, item_id, component_id, updateData } = payload;

  try {
    // Step 1: Dispatch API call
    const dispatchRes = await fetch(
      `https://doms-k1fi.onrender.com/api/masters/glass/dispatch/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      }
    );

    const dispatchResponse = await dispatchRes.json();
    if (!dispatchRes.ok || !dispatchResponse.success) {
      throw new Error(dispatchResponse.message || "Dispatch failed");
    }

    const comp = dispatchResponse?.data?.component;
    const itemStatus = dispatchResponse?.data?.item_status;
    const orderStatus = dispatchResponse?.data?.order_status;

    // Step 2: Fetch complete component (with vehicles)
    let completeComponentData = comp;
    try {
      const componentRes = await fetch(
        `https://doms-k1fi.onrender.com/api/masters/glass/component/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        { method: "GET", headers: { "Content-Type": "application/json" } }
      );

      if (componentRes.ok) {
        const componentData = await componentRes.json();
        if (componentData.success && componentData.data) {
          completeComponentData = {
            ...comp,
            vehicle_details: componentData.data.vehicle_details || [],
            ...componentData.data,
          };
        }
      }
    } catch (fetchError) {
      console.warn("⚠️ Could not fetch complete component data");
      completeComponentData = {
        ...comp,
        vehicle_details: comp.vehicle_details || []
      };
    }

    // Step 3: Build updated component
    const updatedComponent = {
      component_id: completeComponentData?.component_id,
      name: completeComponentData?.name,
      status: completeComponentData?.status,
      dispatch_date: completeComponentData?.dispatch_date,
      dispatched_by: completeComponentData?.dispatched_by,
      deco_sequence: completeComponentData?.deco_sequence,
      vehicle_details: completeComponentData?.vehicle_details,
      decorations: completeComponentData?.decorations || {},
      tracking: [] // keep tracking array
    };

    const itemChanges = { item_id, new_status: itemStatus };
    const orderChanges = { order_number, new_status: orderStatus };

    // Step 4: Emit back to self
    socket.emit("glassDispatchUpdatedSelf", {
      order_number, item_id, component_id, updatedComponent, itemChanges, orderChanges
    });

    // Step 5: Broadcast to PRODUCTION only
    console.log(`📢 [Socket] Broadcasting updates for order ${order_number}, item ${item_id}`);

    io.to("production").emit("glassDispatchUpdated", {
      order_number, item_id, component_id, updatedComponent, itemChanges, orderChanges
    });

    io.to("production").emit("componentDispatchedFromGlass", {
      order_number,
      item_id,
      component_id,
      component_name: completeComponentData.name,
      component_data: {
        ...completeComponentData,
        vehicle_details: completeComponentData.vehicle_details || []
      },
      deco_sequence: completeComponentData.deco_sequence,
      from_team: "glass",
      timestamp: new Date().toISOString(),
      message: `Component ${completeComponentData.name} dispatched with sequence ${completeComponentData.deco_sequence}`
    });

    if (completeComponentData.vehicle_details?.length > 0) {
      io.to("production").emit("vehicleApprovalRequired", {
        order_number,
        item_id,
        component_id,
        component_name: completeComponentData.name,
        vehicle_details: completeComponentData.vehicle_details,
        deco_sequence: completeComponentData.deco_sequence,
        timestamp: new Date().toISOString(),
        message: `Vehicle approval required for component ${completeComponentData.name} (${completeComponentData.deco_sequence})`
      });
    }

    // Extra: send vehicle details explicitly
    if (completeComponentData.vehicle_details?.length > 0 && completeComponentData.deco_sequence) {
      io.to("production").emit("vehicleDetailsReceived", {
        order_number,
        item_id,
        component_id,
        vehicle_details: completeComponentData.vehicle_details,
        deco_sequence: completeComponentData.deco_sequence,
        timestamp: new Date().toISOString(),
      });
    }

  } catch (err) {
    console.error("❌ [Socket] Glass dispatch error:", err.message);
    socket.emit("orderDispatchError", err.message);
  }
});

socket.on("dispatchDecorationComponent", async (payload) => {
  const { team, order_number, item_id, component_id, updateData } = payload;
  
  try {
    const dispatchRes = await fetch(
      `https://doms-k1fi.onrender.com/api/deco/dispatch/${team}/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      }
    );

    const dispatchResponse = await dispatchRes.json();
    if (!dispatchRes.ok || !dispatchResponse.success) {
      throw new Error(dispatchResponse.message || `${team} dispatch failed`);
    }

    const comp = dispatchResponse?.data?.component;
    const itemStatus = dispatchResponse?.data?.item_status;
    const orderStatus = dispatchResponse?.data?.order_status;

    // FIXED: Make sure deco_sequence is properly included
    const updatedComponent = {
      component_id: comp?.component_id,
      name: comp?.name,
      component_type: comp?.component_type,
      decorations: comp?.decorations || {},
      deco_sequence: comp?.deco_sequence || null,
      status: comp?.status,
      is_deco_approved: comp?.is_deco_approved,
      vehicle_details: comp?.vehicle_details || [],
      dispatch_date: comp?.decorations?.[team]?.dispatch_date,
      dispatched_by: comp?.decorations?.[team]?.dispatched_by,
      last_updated: new Date().toISOString()
    };

    const itemChanges = { item_id, new_status: itemStatus };
    const orderChanges = { order_number, new_status: orderStatus };

    console.log(`✅ [Server] ${team} dispatch successful:`, {
      order_number,
      component_id,
      decorations: updatedComponent.decorations,
      sequence: updatedComponent.deco_sequence, 
    
    });

    if (!updatedComponent.deco_sequence) {
      console.warn(`⚠️ [Server] No deco_sequence found for component ${component_id}. Full component data:`, comp);
    }

    socket.emit("decorationDispatchUpdatedSelf", {
      success: true,
      team,
      order_number,
      item_id,
      component_id,
      updatedComponent,
      itemChanges,
      orderChanges
    });

    if (updatedComponent.deco_sequence) {
      io.to("production").emit("decorationComponentDispatched", {
        team,
        order_number,
        item_id,
        component_id,
        updatedComponent, 
        itemChanges,
        orderChanges,
        timestamp: new Date().toISOString()
      });

      const sequence = updatedComponent.deco_sequence.split('_').filter(Boolean);
      const currentTeamIndex = sequence.indexOf(team);
      const nextTeam = sequence[currentTeamIndex + 1];

      console.log(`🔄 [Server] Sequence check:`, {
        full_sequence: sequence,
        current_team: team,
        current_index: currentTeamIndex,
        next_team: nextTeam
      });

      if (nextTeam) {
        console.log(`📨 [Server] Notifying next team: ${nextTeam}`);
        
        io.to("production").emit("teamCanStartWork", {
          order_number,
          item_id,
          component_id,
          team: nextTeam,
          deco_sequence: updatedComponent.deco_sequence,
          previous_team: team,
          timestamp: new Date().toISOString()
        });
      } else {
        console.log(`✅ [Server] ${team} is the last team in sequence`);
      }
    } else {
      console.error(`❌ [Server] Cannot broadcast dispatch - no deco_sequence for component ${component_id}`);
      // Still send self confirmation even if sequence is missing
    }

  } catch (err) {
    console.error(`❌ [Socket] ${team} dispatch error:`, err.message);
    
    // Send error response to dispatching team
    socket.emit("decorationDispatchUpdatedSelf", {
      success: false,
      team,
      message: err.message,
      order_number,
      item_id,
      component_id
    });
  }
});


socket.on("markVehicleDelivered", async (payload) => {
  const { team, order_number, item_id, component_id, updateData, deco_sequence } = payload;

  try {
    console.log(`🚛 [${team}] Marking single vehicle as delivered:`, { order_number, component_id });

    const vehicleRes = await fetch(
      `https://doms-k1fi.onrender.com/api/masters/glass/vehicle/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      }
    );

    const vehicleResponse = await vehicleRes.json();
    if (!vehicleRes.ok || !vehicleResponse.success) {
      throw new Error(vehicleResponse.message || "Vehicle update failed");
    }

    // Broadcast to all teams in sequence
    io.to("production").emit("vehicleMarkedDelivered", {
      order_number,
      item_id,
      component_id,
      vehicle_details: vehicleResponse.data,
      deco_sequence,
      marked_by: team,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error(`❌ [${team}] Vehicle delivery error:`, err.message);
    socket.emit("vehicleUpdateError", err.message);
  }
});

socket.on("markAllVehiclesDelivered", async (payload) => {
  const { team, order_number, item_id, component_id, updateData, deco_sequence, mark_all } = payload;

  try {
    console.log(`🚛 [${team}] Marking ALL vehicles as delivered:`, { order_number, component_id });

    const vehicleRes = await fetch(
      `https://doms-k1fi.onrender.com/api/masters/glass/vehicle/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updateData),
      }
    );

    const vehicleResponse = await vehicleRes.json();
    if (!vehicleRes.ok || !vehicleResponse.success) {
      throw new Error(vehicleResponse.message || "Vehicle update failed");
    }

    // FIXED: Broadcast to all teams in sequence with all_marked flag
    io.to("production").emit("vehicleMarkedDelivered", {
      order_number,
      item_id,
      component_id,
      vehicle_details: vehicleResponse.data,
      deco_sequence,
      marked_by: team,
      all_marked: true, // FIXED: This was missing
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error(`❌ [${team}] All vehicles delivery error:`, err.message);
    socket.emit("vehicleUpdateError", err.message);
  }
});
 
  socket.on("updateGlassVehicle", async (payload) => {
    const { order_number, item_id, component_id, updateData } = payload;

    try {
      const vehicleRes = await fetch(
        `https://doms-k1fi.onrender.com/api/masters/glass/vehicle/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        }
      );

      const vehicleResponse = await vehicleRes.json();
      if (!vehicleRes.ok || !vehicleResponse.success) {
        throw new Error(vehicleResponse.message || "Vehicle update failed");
      }

      const updatedComponent = {
        component_id: component_id,
        vehicle_details: vehicleResponse.data
      };

      socket.emit("glassVehicleUpdatedSelf", { order_number, item_id, component_id, updatedComponent });
      io.to("production").emit("glassVehicleUpdated", { order_number, item_id, component_id, updatedComponent });

    } catch (err) {
      console.error("❌ [Socket] Glass vehicle update error:", err.message);
      socket.emit("glassVehicleError", err.message);
    }
  });


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
        throw new Error(`Failed to update glass stock: ${response.statusText}`);
      }

      const updatedGlass = await response.json();
      const newStock = updatedGlass?.data?.available_stock;

      socket.emit("glassStockUpdatedSelf", {
        data_code,
        newStock,
        message: "Stock updated successfully",
      });
      
      // Broadcast to all production teams
      io.to("production").emit("glassStockUpdated", {
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
      io.to("production").emit("glassAdded", createdGlass);

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
      io.to("production").emit("glassUpdated", updatedGlass);

    } catch (err) {
      console.error("❌ [Socket] Update Glass error:", err.message);
      socket.emit("glassUpdateError", err.message);
    }
  });

  socket.on("deleteGlass", async ({ productId }) => {
    try {
      console.log(`🗑️ [Socket] Delete request received for glassId: ${productId}`);

      const response = await fetch(
        `https://doms-k1fi.onrender.com/api/masters/glass/${productId}`,
        {
          method: "DELETE",
        }
      );

      if (response.ok) {
        console.log(`✅ [Socket] Glass ${productId} deleted via API`);

        socket.emit("glassDeletedSelf", {
          productId,
          message: "Glass deleted successfully",
        });

        io.to("production").emit("glassDeleted", { productId });
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
      const glassRes = await fetch(
        `https://doms-k1fi.onrender.com/api/masters/glass/production/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...updateData, username }),
        }
      );
      
      const glassResponse = await glassRes.json();
      if (!glassRes.ok || !glassResponse.success) {
        throw new Error(glassResponse.message || "Glass update failed");
      }

      const updatedComponent = glassResponse?.data?.component;
      
      socket.emit("glassProductionUpdatedSelf", { order_number, item_id, component_id, updatedComponent });
      io.to("production").emit("glassProductionUpdated", { order_number, item_id, component_id, updatedComponent });

      // Handle stock adjustment if needed
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
        if (stockRes.ok && stockResponse.success) {
          const updatedGlass = stockResponse?.data;
          socket.emit("glassStockAdjustedSelf", {
            dataCode: updatedGlass?.data_code,
            newStock: updatedGlass?.available_stock,
          });
          io.to("production").emit("glassStockAdjusted", {
            dataCode: updatedGlass?.data_code,
            newStock: updatedGlass?.available_stock,
          });
        }
      }
    } catch (err) {
      console.error("❌ [Socket] Glass update error:", err.message);
      socket.emit("glassProductionError", err.message);
    }
  });


  socket.on("updateTeamVehicle", async (payload) => {
    const { team, order_number, item_id, component_id, updateData, deco_sequence } = payload;

    try {
      const vehicleRes = await fetch(
        `https://doms-k1fi.onrender.com/api/masters/glass/vehicle/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        }
      );

      const vehicleResponse = await vehicleRes.json();
      if (!vehicleRes.ok || !vehicleResponse.success) {
        throw new Error(vehicleResponse.message || `${team} vehicle update failed`);
      }

      const updatedComponent = {
        component_id: component_id,
        vehicle_details: vehicleResponse.data,
        deco_sequence: deco_sequence
      };

      // Single broadcast to production room
      io.to("production").emit("vehicleDetailsUpdated", {
        order_number,
        item_id,
        component_id,
        updatedComponent,
        updated_by: team,
        deco_sequence,
        timestamp: new Date().toISOString()
      });

      // Check if all vehicles are approved
      const allApproved = vehicleResponse.data.every(v =>
        v.status === "DELIVERED" || (v.received === true && v.approved === true)
      );

      if (allApproved) {
        io.to("production").emit("vehicleApprovalCompleted", {
          order_number,
          item_id,
          component_id,
          deco_sequence,
          approved_by: team,
          timestamp: new Date().toISOString(),
        });
      }

    } catch (err) {
      console.error(`❌ [Socket] ${team} vehicle update error:`, err.message);
      socket.emit("vehicleUpdateError", err.message);
    }
  });


  socket.on("updateDecorationProduction", async (payload) => {
    const { team, order_number, item_id, component_id, updateData } = payload;

    try {
      const response = await fetch(
        `https://doms-k1fi.onrender.com/api/deco/production/${team}/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        }
      );

      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || `${team} production update failed`);
      }

      const updatedComponent = result?.data;

      socket.emit("decorationProductionUpdatedSelf", {
        team,
        order_number,
        item_id,
        component_id,
        updatedComponent
      });

      io.to("production").emit("decorationProductionUpdated", {
        team,
        order_number,
        item_id,
        component_id,
        updatedComponent
      });

    } catch (err) {
      console.error(`❌ [Socket] ${team} production update error:`, err.message);
      socket.emit("decorationProductionError", { team, message: err.message });
    }
  });



  socket.on("rollbackGlassProduction", async (payload) => {
    const { order_number, item_id, component_id, updateData, component_data_code } = payload;

    try {
      // Clear vehicle details first
      const vehicleRes = await fetch(
        `https://doms-k1fi.onrender.com/api/masters/glass/vehicle/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ vehicle_details: [] }),
        }
      );

      const vehicleResponse = await vehicleRes.json();
      if (vehicleRes.ok && vehicleResponse.success) {
        io.to("production").emit("glassVehicleUpdated", {
          order_number,
          item_id,
          component_id,
          updatedComponent: { component_id, vehicle_details: [] }
        });
      }

      // Perform rollback
      const res = await fetch(
        `https://doms-k1fi.onrender.com/api/orders/rollback/component/${encodeURIComponent(order_number)}/${item_id}/${component_id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updateData),
        }
      );

      const response = await res.json();
      if (!res.ok || !response.success) {
        throw new Error(response.message || "Rollback failed");
      }

      const componentChanges = response?.data?.component_changes;
      const itemChanges = response?.data?.item_changes;
      const orderChanges = response?.data?.order_changes;

      const updatedComponent = {
        component_id: componentChanges?.component_id,
        name: componentChanges?.component_name,
        status: componentChanges?.new_status,
        completed_qty: componentChanges?.new_completed_qty,
        vehicle_details: []
      };

      socket.emit("glassRollbackUpdatedSelf", {
        order_number, item_id, component_id, updatedComponent, itemChanges, orderChanges
      });

      io.to("production").emit("glassRollbackUpdated", {
        order_number, item_id, component_id, updatedComponent, itemChanges, orderChanges
      });

      // Adjust stock if needed
      if (updateData.quantity_to_rollback > 0) {
        const stockRes = await fetch(
          `https://doms-k1fi.onrender.com/api/masters/glass/stock/adjust/${component_data_code}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ adjustment: updateData.quantity_to_rollback }),
          }
        );

        const stockResponse = await stockRes.json();
        if (stockRes.ok && stockResponse.success) {
          const updatedGlass = stockResponse?.data;
          socket.emit("glassStockAdjustedSelf", {
            dataCode: updatedGlass?.data_code,
            newStock: updatedGlass?.available_stock,
          });
          io.to("production").emit("glassStockAdjusted", {
            dataCode: updatedGlass?.data_code,
            newStock: updatedGlass?.available_stock,
          });
        }
      }

    } catch (err) {
      console.error("❌ [Socket] Glass rollback error:", err.message);
      socket.emit("glassRollbackError", { message: err.message });
    }
  });

  // Glass negative adjustment
  socket.on("negativeAdjustmentGlassComponent", async (payload) => {
    const { order_number, item_id, component_id, updateData } = payload;

    try {
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
      };

      const itemChanges = {
        item_id,
        new_status: comp?.status === "COMPLETED" ? "COMPLETED" : "IN_PROGRESS",
      };

      const orderChanges = { order_number, new_status: orderStatus };

      socket.emit("glassNegativeAdjustmentUpdatedSelf", {
        order_number, item_id, component_id, updatedComponent,
        adjustmentSummary, itemChanges, orderChanges
      });

      io.to("production").emit("glassNegativeAdjustmentUpdated", {
        order_number, item_id, component_id, updatedComponent,
        adjustmentSummary, itemChanges, orderChanges
      });

    } catch (err) {
      console.error("❌ [Socket] glass negative adjustment error:", err.message);
      socket.emit("glassNegativeAdjustmentError", { message: err.message });
    }
  });
}