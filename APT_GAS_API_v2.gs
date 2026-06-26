// ============================================================
//  APT ERP — GAS REST API v2.2 — COMPLETE FIX
//  ADD THIS AS A SEPARATE FILE in Apps Script (File → New → Script)
//  Name it: "z_API"
//
//  FIXES:
//  - Invoice ID now properly passed to PDF
//  - Logo URL included
//  - Currency set to PKR (Pakistani Rupees)
//  - Customer name properly resolved
// ============================================================

var API_CFG = {
  SHEET_ID:    "1-L73aqBLjapsE53MTnYkJ2HvRjYlql-wM1QjgPvLs_w",
  API_KEY:     "APT_SECRET_2025",
  DRIVE_FOLDER:"1cCU3BBUbHE1YeTTxxOGJztMtpqplQ8sk",
  INV_API_KEY: "sk_pXxXFBgSwoyZH1IgBusintr96QQYIoYH",
  TZ:          "Asia/Karachi",
  // ✅ Add your logo URL here (must be publicly accessible)
  LOGO_URL:    "https://drive.google.com/uc?export=view&id=1TV37W_HrwBq22FTHmoBZMpiDeXXxOMnI",
  CURRENCY:    "PKR",
  ADDRESS:     "Assprted Produce Traders, FF27, Zarpar Arcade, D12 Markaz, Islamabad",
};

// ── SAFE CFG FALLBACK ────────────────────────────────────────
if (typeof CFG === "undefined") {
  var CFG = {
    SHEET_ID:     API_CFG.SHEET_ID,
    API_KEY:      API_CFG.API_KEY,
    DRIVE_FOLDER: API_CFG.DRIVE_FOLDER,
    INV_API_KEY:  API_CFG.INV_API_KEY,
    TZ:           API_CFG.TZ,
    LOGO_URL:     API_CFG.LOGO_URL,
    CUST:         "02_Customers",
    VEN:          "03_Vendors",
    PROD:         "04_Products",
    INV_H:        "05_Invoice_Headers",
    INV_I:        "06_Invoice_Items",
    PUR_H:        "08_Purchase_Headers",
    PAY:          "10_Payments",
    EXP:          "11_Expenses",
    AR:           "12_AR_Ledger",
    AP:           "13_AP_Ledger",
    INV_L:        "14_Inventory_List"
  };
}

// ── CORS + Response helpers ──────────────────────────────────
function _apiCors(out) {
  return out;
}

function _apiJson(obj) {
  return _apiCors(
    ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON)
  );
}

function _apiOk(data) {
  return _apiJson({ success: true, data: data });
}

function _apiErr(msg, code) {
  Logger.log("API Error: " + msg);
  return _apiJson({ success: false, error: msg, code: code || 400 });
}

function _apiAuth(e) {
  try {
    var k = (e.parameter && e.parameter.key) ||
            (e.postData && JSON.parse(e.postData.contents || "{}").key) || "";
    return k === API_CFG.API_KEY;
  } catch(ex) {
    return false;
  }
}

// ── OPTIONS preflight (CORS) ─────────────────────────────────
function doOptions(e) {
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT);
}

// ============================================================
//  doGet — READ OPERATIONS
// ============================================================
function doGet(e) {
  e = e || {};
  
  // ── PUBLIC RIDER APP ENDPOINT (BYPASSES AUTH) ─────────────────
  var type = e.parameter && e.parameter.type;
  if (type === "GET_PRODUCT") {
    var pid = (e.parameter.pid || "").toString().trim().toUpperCase();
    if (!pid) {
      return ContentService.createTextOutput(JSON.stringify({}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var ss = _getSs();
    if (!ss) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Spreadsheet not found" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // Support "04_Product_Master" or configured fallback "04_Products"
    var sheet = ss.getSheetByName("04_Product_Master") || ss.getSheetByName(CFG.PROD || "04_Products");
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Product sheet not found" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim().toUpperCase() === pid) {
        return ContentService.createTextOutput(JSON.stringify({
          name: data[i][1] ? data[i][1].toString().trim() : "",
          category: data[i][2] ? data[i][2].toString().trim() : "",
          vendor: data[i][4] ? data[i][4].toString().trim() : "",
          trade_price: parseFloat(data[i][6]) || 0
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    return ContentService.createTextOutput(JSON.stringify({}))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  if (!_apiAuth(e)) return _apiErr("Unauthorized", 401);
  
  var action = (e.parameter && e.parameter.action) || "dashboard";
  var ss = _getSs();
  if (!ss) return _apiErr("Spreadsheet not found. Verify SHEET_ID.", 500);

  try {
    switch (action) {
      case "all": {
        var customers  = _readCustomers(ss);
        var vendors    = _readVendors(ss);
        var products   = _readProducts(ss);
        var invoices   = _readInvoices(ss, parseInt(e.parameter.limit) || 300);
        var purchases  = _readPurchases(ss);
        var payments   = _readPayments(ss);
        var expenses   = _readExpenses(ss);
        var ar         = _readAR(ss);
        var ap         = _readAP(ss);
        var inventory  = _readInventory(ss);
        var dashboard  = _readDashboard(ss);
        
        return _apiOk({
          dashboard, customers, vendors, products, invoices,
          purchases, payments, expenses, ar, ap, inventory,
          lastSync: new Date().toISOString()
        });
      }

      case "dashboard":  return _apiOk(_readDashboard(ss));
      case "customers":  return _apiOk(_readCustomers(ss));
      case "vendors":    return _apiOk(_readVendors(ss));
      case "products":   return _apiOk(_readProducts(ss));
      case "purchases":  return _apiOk(_readPurchases(ss));
      case "payments":   return _apiOk(_readPayments(ss));
      case "expenses":   return _apiOk(_readExpenses(ss));
      case "ar_ledger":  return _apiOk(_readAR(ss));
      case "ap_ledger":  return _apiOk(_readAP(ss));
      case "inventory":  return _apiOk(_readInventory(ss));

      case "invoices": {
        var limit = parseInt(e.parameter.limit) || 300;
        return _apiOk(_readInvoices(ss, limit));
      }

      case "invoice_items": {
        var invId = e.parameter.id;
        if (!invId) return _apiErr("id parameter required");
        return _apiOk(_readInvoiceItems(ss, invId));
      }

      case "pdf_url": {
        var invId = e.parameter.id;
        if (!invId) return _apiErr("id required");
        var url = _findPdfInDrive(invId);
        if (url) return _apiOk({ url: url, found: true });
        
        var pdfUrl = _generatePdfForInvoice(ss, invId);
        return _apiOk({ url: pdfUrl, found: !!pdfUrl });
      }

      case "rider_journey": {
        var riderId = e.parameter.rider || "";
        return _apiOk(_readRiderJourney(ss, riderId));
      }

      case "rider_orders": {
        var riderId = e.parameter.rider || "";
        return _apiOk(_readRiderOrders(ss, riderId));
      }

      default:
        return _apiErr("Unknown action: " + action);
    }
  } catch(err) {
    Logger.log("doGet error: " + err.message + "\n" + err.stack);
    return _apiErr("Server error: " + err.message, 500);
  }
}

// ============================================================
//  doPost — WRITE OPERATIONS
// ============================================================
// ── Webhook handler for mirrorToSheets payloads (no API key required) ───────
function _handleMirrorWebhook(type, payload) {
  var ss = _getSs();
  if (!ss) return _apiJson({ ok: false, reason: "spreadsheet_not_found" });

  if (type === "visit") {
    return _apiJson({ ok: true, message: "visit_ack" });
  }

  if (type === "store") {
    return _syncStoreFromWebhook(ss, payload);
  }

  if (type === "order") {
    return _syncOrderFromWebhook(ss, payload);
  }

  return _apiJson({ ok: false, reason: "unknown_type" });
}

function _syncStoreFromWebhook(ss, payload) {
  if (!payload || !payload.name) return _apiJson({ ok: false, reason: "missing_name" });

  var ws = ss.getSheetByName(CFG.CUST);
  var rows = ws.getDataRange().getValues();

  // Check for existing customer with this supabase_id to avoid duplicates
  var supabaseRef = "supabase_id:" + (payload.id || "");
  for (var i = 3; i < rows.length; i++) {
    if (rows[i][0] && String(rows[i][7]).indexOf(supabaseRef) !== -1) {
      return _apiJson({ ok: true, customer_id: String(rows[i][0]), message: "already_exists" });
    }
  }

  var newId = _getNextCustomerId(ss);
  var row = _apiGetLastDataRow(ws, 1) + 1;
  if (row < 4) row = 4;

  ws.getRange(row, 1).setValue(newId);
  ws.getRange(row, 2).setValue(payload.name || "Unknown Store");
  ws.getRange(row, 3).setValue(payload.city || payload.area || "ISB");
  ws.getRange(row, 4).setValue(payload.area || "");
  ws.getRange(row, 5).setValue(payload.owner_name || "");
  ws.getRange(row, 6).setValue(payload.mobile || "");
  ws.getRange(row, 7).setValue(0);
  ws.getRange(row, 8).setValue("supabase_id:" + (payload.id || ""));

  _ensureCustomerInAR(ss, newId);

  return _apiJson({ ok: true, customer_id: newId, message: "store synced as customer" });
}

function _syncOrderFromWebhook(ss, payload) {
  if (!payload) return _apiJson({ ok: false, reason: "missing_payload" });

  // Resolve or create customer
  var custId = payload.gas_customer_id || null;

  if (!custId && payload.store_id) {
    // Try to find by supabase_id in notes
    var custWs = ss.getSheetByName(CFG.CUST);
    var custRows = custWs.getDataRange().getValues();
    var supabaseRef = "supabase_id:" + payload.store_id;
    for (var i = 3; i < custRows.length; i++) {
      if (custRows[i][0] && String(custRows[i][7]).indexOf(supabaseRef) !== -1) {
        custId = String(custRows[i][0]);
        break;
      }
    }
  }

  if (!custId && payload.store_name) {
    // Create customer
    var syncResult = _syncStoreFromWebhook(ss, {
      id: payload.store_id,
      name: payload.store_name,
      area: payload.area,
      owner_name: payload.owner_name,
      mobile: payload.mobile
    });
    // Parse customer_id from JSON result
    try {
      var syncData = JSON.parse(syncResult.getContent());
      custId = syncData.customer_id || null;
    } catch(ex) {}
  }

  if (!custId) return _apiJson({ ok: false, reason: "cannot_resolve_customer" });

  // Map webhook items to GAS format
  var items = (payload.items || []).map(function(it) {
    return {
      pid:   it.product_id || "",
      pname: it.product_name || "",
      qty:   parseFloat(it.quantity) || 0,
      rate:  parseFloat(it.trade_price) || 0
    };
  });
  if (!items.length) return _apiJson({ ok: false, reason: "no_items" });

  var invWs = ss.getSheetByName(CFG.INV_H);
  var invId = _getNextId(invWs, "INV");
  var date = payload.created_at ? String(payload.created_at).split("T")[0] : new Date().toISOString().split("T")[0];
  var total = parseFloat(payload.total_value) || items.reduce(function(s, i) { return s + i.qty * i.rate; }, 0);

  var d = {
    invId:     invId,
    custId:    custId,
    custName:  _resolveCustomerName(ss, custId, {}),
    items:     items,
    notes:     "[Rider App] " + (payload.notes || ""),
    createdBy: "rider:" + (payload.rider_id || ""),
    payTerms:  "COD",
    date:      date
  };

  _writeInvoiceToSheet(ss, invId, d, total);

  return _apiJson({ ok: true, invoice_id: invId, message: "order synced as invoice" });
}

function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return _apiErr("Missing POST body", 400);
  }

  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch(ex) {
    return _apiErr("Invalid JSON: " + ex.message, 400);
  }

  // ── mirrorToSheets webhook: { type, payload, ts } — no API key required ──────
  if (body.type && body.payload) {
    return _handleMirrorWebhook(body.type, body.payload);
  }

  if (!_apiAuth({postData: {contents: JSON.stringify(body)}})) {
    return _apiErr("Unauthorized", 401);
  }

  var action = body.action;
  var ss = _getSs();
  if (!ss) return _apiErr("Spreadsheet not found. Verify SHEET_ID.", 500);

  try {
    switch(action) {

      // ══════════════════════════════════════════════════════
      //  SAVE INVOICE — FIXED VERSION WITH PROPER ID HANDLING
      // ══════════════════════════════════════════════════════
      case "save_invoice": {
        var d = body.data;
        if (!d || !d.custId || !d.items || !d.items.length) {
          return _apiErr("Missing custId or items");
        }

        // Step 1: Generate Invoice ID
        var invId = _getNextId(ss.getSheetByName(CFG.INV_H), "INV");
        d.invId = invId;
        Logger.log("✓ Generated Invoice ID: " + invId);

        // Step 2: Resolve Customer Name + area/purchaser details
        var custName = _resolveCustomerName(ss, d.custId, d);
        d.custName = custName;
        d.customerName = custName;
        d.customer = custName;
        Logger.log("✓ Resolved Customer Name: " + custName);
        var custRecord  = _lookupCustomer(ss, d.custId);
        var custArea    = custRecord ? custRecord.area    : "";
        var custContact = custRecord ? custRecord.contact : "";
        var custPhone   = custRecord ? custRecord.phone   : "";

        // Step 3: Set creator
        d.createdBy = body.createdBy || d.createdBy || "api";

        // Step 4: Compute total
        var total = d.items.reduce(function(s, i) {
          return s + ((parseFloat(i.qty) || 0) * (parseFloat(i.rate) || 0));
        }, 0) * (1 + (parseFloat(d.tax) || 0) / 100);

        // Step 5: Write directly to sheet (no legacy saveInvoice call)
        var result = _writeInvoiceToSheet(ss, invId, d, total);
        Logger.log("✓ " + result);

        // Step 6: Generate PDF (PKR, logo, address)
        Utilities.sleep(2000);
        var pdfUrl = "";
        try {
          pdfUrl = _customGeneratePDF({
            invId: invId,
            date: d.date || _today(),
            custId: d.custId,
            custName: custName,
            customerName: custName,
            customer: custName,
            custArea: custArea,
            custContact: custContact,
            custPhone: custPhone,
            payTerms: d.payTerms || "COD",
            notes: d.notes || "Thank you for your business.",
            tax: d.tax || 0,
            items: d.items,
            currency: CFG.CURRENCY,
            logoUrl: CFG.LOGO_URL,
            address: CFG.ADDRESS
          }, total);
          Logger.log("✓ PDF generated: " + pdfUrl);
        } catch(pdfErr) {
          Logger.log("✗ PDF generation failed: " + pdfErr.message);
          pdfUrl = "";
        }

        return _apiOk({
          message: result,
          id: invId,  // ✅ Return the correct ID
          pdfUrl: pdfUrl,
          customerName: custName
        });
      }

      // ══════════════════════════════════════════════════════
      //  SAVE EXPENSE
      // ══════════════════════════════════════════════════════
      case "save_expense": {
        var d = body.data;
        if (!d || !d.amount) return _apiErr("Missing amount");
        
        d.paidBy = body.user || d.by || "api";
        var result = saveExpense(ss, {
          expId: _getNextId(ss.getSheetByName(CFG.EXP), "EXP"),
          date: d.date || _today(),
          cat: d.category || "Misc",
          desc: d.notes || d.desc || "",
          amount: parseFloat(d.amount),
          paidBy: d.paidBy,
          notes: d.notes || ""
        });
        
        return _apiOk({ message: result });
      }

      // ══════════════════════════════════════════════════════
      //  SAVE PAYMENT
      // ══════════════════════════════════════════════════════
      case "save_payment": {
        var d = body.data;
        if (!d || !d.amount) return _apiErr("Missing amount");
        
        var result = savePayment(ss, {
          payId: _getNextId(ss.getSheetByName(CFG.PAY), "PAY"),
          date: d.date || _today(),
          type: d.type || "Received",
          partyId: d.custId || d.vendorId || d.partyId || "",
          refId: d.invId || d.purId || d.refId || "",
          amount: parseFloat(d.amount),
          notes: (d.method || "Cash") + (d.notes ? " — " + d.notes : "")
        });
        
        if (d.invId && d.type === "Received") {
          _updateInvoiceStatus(ss, d.invId, parseFloat(d.amount));
        }
        if (d.custId && d.type === "Received") {
          _recalcAR(ss, d.custId);
        }

        return _apiOk({ message: result });
      }

      // ══════════════════════════════════════════════════════
      //  SAVE PURCHASE
      // ══════════════════════════════════════════════════════
      case "save_purchase": {
        var d = body.data;
        if (!d || !d.vendorId || !d.total) {
          return _apiErr("Missing vendorId or total");
        }
        
        var items = d.items || [{
          pid: "",
          qty: 1,
          cost: parseFloat(d.total),
          total: parseFloat(d.total)
        }];
        
        var result = savePurchase(ss, {
          purId: _getNextId(ss.getSheetByName(CFG.PUR_H), "PUR"),
          date: d.date || _today(),
          venId: d.vendorId,
          notes: d.notes || "",
          items: items
        });
        
        return _apiOk({ message: result });
      }

      // ══════════════════════════════════════════════════════
      //  ADD CUSTOMER
      // ══════════════════════════════════════════════════════
      case "add_customer": {
        // Accept both body.data (CRM frontend) and body.customer (pushOrderToGAS)
        var d = body.data || body.customer || {};
        if (!d || !d.name) return _apiErr("Missing name");

        var ws = ss.getSheetByName(CFG.CUST);

        // Check for duplicate by supabase store_id in notes
        if (d.store_id) {
          var existRows = ws.getDataRange().getValues();
          var ref = "supabase_id:" + d.store_id;
          for (var ei = 3; ei < existRows.length; ei++) {
            if (existRows[ei][0] && String(existRows[ei][7]).indexOf(ref) !== -1) {
              var existId = String(existRows[ei][0]);
              return _apiOk({ id: existId, customer_id: existId, message: "Customer already exists: " + existId });
            }
          }
        }

        var newId = _getNextCustomerId(ss);
        var row = _apiGetLastDataRow(ws, 1) + 1;
        if (row < 4) row = 4;

        ws.getRange(row, 1).setValue(newId);
        ws.getRange(row, 2).setValue(d.name);
        ws.getRange(row, 3).setValue(d.city || d.area || "ISB");
        ws.getRange(row, 4).setValue(d.area || "");
        ws.getRange(row, 5).setValue(d.contact || d.owner_name || "");
        ws.getRange(row, 6).setValue(d.phone || d.mobile || "");
        ws.getRange(row, 7).setValue(parseFloat(d.openBal) || 0);
        ws.getRange(row, 8).setValue(d.notes || (d.store_id ? "supabase_id:" + d.store_id : ""));

        _ensureCustomerInAR(ss, newId);

        return _apiOk({
          id: newId,
          customer_id: newId,
          message: "Customer " + newId + " added: " + d.name
        });
      }

      // ══════════════════════════════════════════════════════
      //  EDIT CUSTOMER
      // ══════════════════════════════════════════════════════
      case "edit_customer": {
        var d = body.data;
        if (!d || !d.id) return _apiErr("Missing customer id");

        var ws = ss.getSheetByName(CFG.CUST);
        if (!ws) return _apiErr("Customers sheet not found");

        var data = ws.getDataRange().getValues();
        var custId = d.id.toString().trim();

        for (var i = 3; i < data.length; i++) {
          if (data[i][0] && data[i][0].toString().trim() === custId) {
            var row = i + 1;
            if (d.name !== undefined)    ws.getRange(row, 2).setValue(d.name);
            if (d.city !== undefined)    ws.getRange(row, 3).setValue(d.city);
            if (d.area !== undefined)    ws.getRange(row, 4).setValue(d.area);
            if (d.contact !== undefined) ws.getRange(row, 5).setValue(d.contact);
            if (d.phone !== undefined)   ws.getRange(row, 6).setValue(d.phone);
            if (d.openBal !== undefined) ws.getRange(row, 7).setValue(parseFloat(d.openBal) || 0);
            if (d.notes !== undefined)   ws.getRange(row, 8).setValue(d.notes);

            // Keep AR ledger name in sync
            if (d.name) {
              var arWs = ss.getSheetByName(CFG.AR);
              if (arWs) {
                var arData = arWs.getDataRange().getValues();
                for (var j = 3; j < arData.length; j++) {
                  if (arData[j][0] && arData[j][0].toString().trim() === custId) {
                    arWs.getRange(j + 1, 2).setValue(d.name);
                    break;
                  }
                }
              }
            }

            return _apiOk({ id: custId, message: "Customer " + custId + " updated" });
          }
        }
        return _apiErr("Customer not found: " + custId);
      }

      // ══════════════════════════════════════════════════════
      //  MERGE DUPLICATE CUSTOMERS
      //  body.data = { groups: [ { keepId, mergeIds: [...] }, ... ] }
      //  Re-points every invoice + payment from each mergeId onto keepId,
      //  removes the duplicate Customers/AR rows, then recalculates AR.
      // ══════════════════════════════════════════════════════
      case "merge_customers": {
        var d = body.data;
        if (!d || !d.groups || !d.groups.length) return _apiErr("Missing groups");
        var result = _mergeCustomers(ss, d.groups);
        return _apiOk(result);
      }

      // ══════════════════════════════════════════════════════
      //  UNDO MERGE CUSTOMERS (reverses the snapshot returned above)
      // ══════════════════════════════════════════════════════
      case "undo_merge_customers": {
        var d = body.data;
        if (!d || !d.groups) return _apiErr("Missing snapshot");
        var result = _undoMergeCustomers(ss, d);
        return _apiOk(result);
      }

      // ══════════════════════════════════════════════════════
      //  ADD VENDOR
      // ══════════════════════════════════════════════════════
      case "save_vendor": {
        var d = body.data;
        if (!d || !d.name) return _apiErr("Missing vendor name");

        var ws = ss.getSheetByName(CFG.VEN);
        if (!ws) return _apiErr("Vendors sheet not found");

        var max = 0;
        if (ws.getLastRow() > 3) {
          ws.getRange(4, 1, ws.getLastRow() - 3, 1).getValues().forEach(function(r) {
            var v = r[0] ? r[0].toString().trim() : "";
            var m = v.match(/^V-?(\d+)$/i);
            if (m) {
              var n = parseInt(m[1]) || 0;
              if (n > max) max = n;
            }
          });
        }
        var newId = "V-" + String(max + 1).padStart(3, "0");

        var row = _apiGetLastDataRow(ws, 1) + 1;
        if (row < 4) row = 4;

        ws.getRange(row, 1, 1, 7).setValues([[
          newId, d.name, d.category || "", d.contact || "",
          d.phone || "", parseFloat(d.openBal) || 0, d.notes || ""
        ]]);

        return _apiOk({
          id: newId,
          message: "Vendor " + newId + " added: " + d.name
        });
      }

      // ══════════════════════════════════════════════════════
      //  EDIT VENDOR
      // ══════════════════════════════════════════════════════
      case "edit_vendor": {
        var d = body.data;
        if (!d || !d.id) return _apiErr("Missing vendor id");

        var ws = ss.getSheetByName(CFG.VEN);
        if (!ws) return _apiErr("Vendors sheet not found");

        var data = ws.getDataRange().getValues();
        var venId = d.id.toString().trim();

        for (var i = 3; i < data.length; i++) {
          if (data[i][0] && data[i][0].toString().trim() === venId) {
            var row = i + 1;
            if (d.name !== undefined)     ws.getRange(row, 2).setValue(d.name);
            if (d.category !== undefined) ws.getRange(row, 3).setValue(d.category);
            if (d.contact !== undefined)  ws.getRange(row, 4).setValue(d.contact);
            if (d.phone !== undefined)    ws.getRange(row, 5).setValue(d.phone);
            if (d.openBal !== undefined)  ws.getRange(row, 6).setValue(parseFloat(d.openBal) || 0);
            if (d.notes !== undefined)    ws.getRange(row, 7).setValue(d.notes);
            return _apiOk({ id: venId, message: "Vendor " + venId + " updated" });
          }
        }
        return _apiErr("Vendor not found: " + venId);
      }

      // ══════════════════════════════════════════════════════
      //  EDIT INVOICE — update header + replace items + new PDF
      // ══════════════════════════════════════════════════════
      case "edit_invoice": {
        var d = body.data;
        if (!d || !d.invId || !d.custId || !d.items || !d.items.length) {
          return _apiErr("Missing invId, custId or items");
        }
        var invId = d.invId.toString().trim();

        var invH = ss.getSheetByName(CFG.INV_H);
        if (!invH) return _apiErr("Invoice Headers sheet not found");

        var hData = invH.getDataRange().getValues();
        var rowIdx = -1, oldCustId = "";
        for (var i = 3; i < hData.length; i++) {
          if (hData[i][0] &&
              hData[i][0].toString().trim().toUpperCase() === invId.toUpperCase()) {
            rowIdx = i + 1;
            oldCustId = hData[i][2] ? hData[i][2].toString().trim() : "";
            break;
          }
        }
        if (rowIdx < 0) return _apiErr("Invoice not found: " + invId);

        var custName = _resolveCustomerName(ss, d.custId, d);
        var custRecord = _lookupCustomer(ss, d.custId);

        var total = d.items.reduce(function(s, i) {
          return s + ((parseFloat(i.qty) || 0) * (parseFloat(i.rate) || 0));
        }, 0) * (1 + (parseFloat(d.tax) || 0) / 100);

        // Update header (status col 6 and creator col 8 are preserved)
        invH.getRange(rowIdx, 2).setValue(d.date || _today());
        invH.getRange(rowIdx, 3).setValue(d.custId);
        invH.getRange(rowIdx, 4).setValue(custName);
        invH.getRange(rowIdx, 5).setValue(total);
        invH.getRange(rowIdx, 7).setValue(d.payTerms || "COD");

        // Capture the pre-edit line items so we can reverse their stock effect.
        var oldItems = _readInvoiceItems(ss, invId);

        // Replace line items
        var invI = ss.getSheetByName(CFG.INV_I);
        if (invI) {
          var iData = invI.getDataRange().getValues();
          for (var i = iData.length - 1; i >= 3; i--) {
            if (iData[i][0] &&
                iData[i][0].toString().trim().toUpperCase() === invId.toUpperCase()) {
              invI.deleteRow(i + 1);
            }
          }
          var iRow = _apiGetLastDataRow(invI, 1) + 1;
          if (iRow < 4) iRow = 4;
          var itemRows = d.items.map(function(item) {
            var qty = parseFloat(item.qty) || 0;
            var rate = parseFloat(item.rate) || 0;
            return [invId, item.pid || "", item.pname || "", qty, rate, qty * rate, item.notes || ""];
          });
          invI.getRange(iRow, 1, itemRows.length, 7).setValues(itemRows);
        }

        // Reverse the old line items' stock effect, then apply the new ones.
        _applyInventoryDelta(ss, oldItems, -1);
        _applyInventoryDelta(ss, d.items, 1);

        // Refresh status against recorded payments + AR balances
        _updateInvoiceStatus(ss, invId, 0);
        _ensureCustomerInAR(ss, d.custId);
        _recalcAR(ss, d.custId);
        if (oldCustId && oldCustId !== d.custId) _recalcAR(ss, oldCustId);

        // Regenerate PDF (replaces old file in Drive)
        var pdfUrl = "";
        try {
          pdfUrl = _customGeneratePDF({
            invId: invId,
            date: d.date || _today(),
            custId: d.custId,
            custName: custName,
            customerName: custName,
            customer: custName,
            custArea:    custRecord ? custRecord.area    : "",
            custContact: custRecord ? custRecord.contact : "",
            custPhone:   custRecord ? custRecord.phone   : "",
            payTerms: d.payTerms || "COD",
            notes: d.notes || "Thank you for your business.",
            tax: d.tax || 0,
            items: d.items
          }, total);
        } catch(pdfErr) {
          Logger.log("Edit invoice PDF error: " + pdfErr.message);
        }

        return _apiOk({
          message: "Invoice " + invId + " updated",
          id: invId,
          pdfUrl: pdfUrl
        });
      }

      // ══════════════════════════════════════════════════════
      //  ADJUST STOCK — manual goods receipt / correction
      //  body.data = { pid, delta, reason }
      // ══════════════════════════════════════════════════════
      case "adjust_stock": {
        var d = body.data;
        if (!d || !d.pid) return _apiErr("Missing product id");
        if (d.delta === undefined || d.delta === null || isNaN(parseFloat(d.delta))) return _apiErr("Missing/invalid delta");
        var res = _adjustStock(ss, d.pid, parseFloat(d.delta));
        return _apiOk(res);
      }

      // ══════════════════════════════════════════════════════
      //  MARK INVOICE PAID
      // ══════════════════════════════════════════════════════
      case "mark_paid": {
        var invId = body.invId;
        if (!invId) return _apiErr("Missing invId");
        
        var ws = ss.getSheetByName(CFG.INV_H);
        var data = ws.getDataRange().getValues();
        var found = false;
        
        for (var i = 3; i < data.length; i++) {
          if (data[i][0] && 
              data[i][0].toString().trim().toUpperCase() === invId.toUpperCase()) {
            ws.getRange(i + 1, 6).setValue("Paid");
            found = true;
            break;
          }
        }
        
        if (!found) return _apiErr(invId + " not found");
        return _apiOk({ message: invId + " marked as Paid" });
      }

      // ══════════════════════════════════════════════════════
      //  SET INVOICE FIELDS — generic status/total setter used to
      //  power undo for "mark_paid" and "void_invoice".
      // ══════════════════════════════════════════════════════
      case "set_invoice_fields": {
        var d = body.data;
        if (!d || !d.invId) return _apiErr("Missing invId");

        var ws = ss.getSheetByName(CFG.INV_H);
        if (!ws) return _apiErr("Invoice Headers sheet not found");

        var data = ws.getDataRange().getValues();
        var found = false, fCustId = "";
        for (var i = 3; i < data.length; i++) {
          if (data[i][0] && data[i][0].toString().trim().toUpperCase() === d.invId.toString().trim().toUpperCase()) {
            if (d.total !== undefined) ws.getRange(i + 1, 5).setValue(d.total);
            if (d.status !== undefined) ws.getRange(i + 1, 6).setValue(d.status);
            fCustId = data[i][2] ? data[i][2].toString().trim() : "";
            found = true;
            break;
          }
        }

        if (!found) return _apiErr(d.invId + " not found");
        if (fCustId) _recalcAR(ss, fCustId);
        return _apiOk({ message: d.invId + " updated" });
      }

      // ══════════════════════════════════════════════════════
      //  GENERATE PDF
      // ══════════════════════════════════════════════════════
      case "generate_pdf": {
        var invId = body.invId;
        if (!invId) return _apiErr("Missing invId");
        
        var pdfUrl = _generatePdfForInvoice(ss, invId);
        if (!pdfUrl) return _apiErr("Failed to generate PDF for " + invId);
        
        return _apiOk({ url: pdfUrl, message: "PDF ready" });
      }

      // ══════════════════════════════════════════════════════
      //  RIDER ORDER (from Rider App)
      // ══════════════════════════════════════════════════════
      case "rider_order": {
        // Accept body.data (CRM/legacy) OR body.order (pushOrderToGAS server fn)
        var raw = body.data || body.order || {};

        // Normalize: body.order uses customer_id + items[{quantity,trade_price,product_id,product_name}]
        //            body.data uses custId + items[{qty,rate,pid,pname}]
        var custId = raw.custId || raw.customer_id || null;
        var rawItems = raw.items || [];
        var normalItems = rawItems.map(function(it) {
          return {
            pid:   it.pid   || it.product_id  || "",
            pname: it.pname || it.product_name || "",
            qty:   parseFloat(it.qty  || it.quantity   || 0),
            rate:  parseFloat(it.rate || it.trade_price || 0)
          };
        });

        if (!custId || !normalItems.length) {
          return _apiErr("Missing custId/customer_id or items");
        }

        // Generate invoice ID
        var invId = _getNextId(ss.getSheetByName(CFG.INV_H), "INV");

        // Resolve customer name + area/purchaser details
        var custName = _resolveCustomerName(ss, custId, raw);
        var custRecord  = _lookupCustomer(ss, custId);

        var d = {
          invId:      invId,
          custId:     custId,
          custName:   custName,
          customerName: custName,
          customer:   custName,
          custArea:   custRecord ? custRecord.area    : "",
          custContact:custRecord ? custRecord.contact : "",
          custPhone:  custRecord ? custRecord.phone   : "",
          createdBy:  body.riderId || raw.rider_id || "rider",
          payTerms:   raw.payTerms || "COD",
          notes:      "[Rider App] " + (raw.notes || ""),
          date:       raw.date || (raw.created_at ? String(raw.created_at).split("T")[0] : null) || "",
          items:      normalItems
        };

        var total = normalItems.reduce(function(s, i) {
          return s + (i.qty * i.rate);
        }, 0);

        var result = _writeInvoiceToSheet(ss, invId, d, total);
        var pdfUrl = "";

        try {
          pdfUrl = _customGeneratePDF(d, total);
        } catch(ex) {
          Logger.log("Rider order PDF error: " + ex.message);
        }

        return _apiOk({
          message: result,
          id: invId,
          invoice_id: invId,
          invoiceId: invId,
          pdfUrl: pdfUrl,
          pdf_url: pdfUrl
        });
      }

      // ══════════════════════════════════════════════════════
      //  VOID INVOICE
      // ══════════════════════════════════════════════════════
      case "void_invoice": {
        var invId = body.invId;
        if (!invId) return _apiErr("Missing invId");

        var voidCustId = _findInvoiceCustId(ss, invId);
        var result = voidInvoice(ss, invId);
        if (voidCustId) _recalcAR(ss, voidCustId);
        return _apiOk({ message: result });
      }

      // ══════════════════════════════════════════════════════
      //  DELETE INVOICE
      // ══════════════════════════════════════════════════════
      case "delete_invoice": {
        var invId = body.invId;
        if (!invId) return _apiErr("Missing invId");

        var delCustId = _findInvoiceCustId(ss, invId);
        var result = _deleteInvoice(ss, invId);
        if (delCustId) _recalcAR(ss, delCustId);
        return _apiOk({ message: result });
      }

      default:
        return _apiErr("Unknown action: " + action);
    }
  } catch(err) {
    Logger.log("doPost error: " + err.message + "\n" + err.stack);
    return _apiErr("Server error: " + err.message, 500);
  }
}

// ============================================================
//  CORE HELPER FUNCTIONS
// ============================================================

function _getSs(ss) {
  if (ss) return ss;
  
  try {
    if (API_CFG.SHEET_ID) {
      return SpreadsheetApp.openById(API_CFG.SHEET_ID);
    }
  } catch(e) {
    Logger.log("openById failed: " + e.message);
  }
  
  try {
    return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.getActive();
  } catch(e) {
    Logger.log("getActiveSpreadsheet failed: " + e.message);
  }
  
  return null;
}

function _today() {
  return Utilities.formatDate(new Date(), API_CFG.TZ, "yyyy-MM-dd");
}

function _fmtDate(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, API_CFG.TZ, "yyyy-MM-dd");
  }
  return val.toString().substring(0, 10);
}

// Whole days elapsed from the given date to today (invoice aging).
// Accepts a Date object or a string. Returns null if unparseable,
// 0 for today or any future date (never negative).
function _daysSince(val) {
  if (val === null || val === undefined || val === "") return null;
  var d;
  if (val instanceof Date) {
    d = val;
  } else {
    d = new Date(val.toString().substring(0, 10));
  }
  if (!d || isNaN(d.getTime())) return null;
  var now = new Date();
  var d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  var t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var diff = Math.floor((t0.getTime() - d0.getTime()) / 86400000);
  return diff < 0 ? 0 : diff;
}

function _apiGetLastDataRow(ws, col) {
  col = col || 1;
  var total = ws.getLastRow();
  if (total < 4) return 3;
  
  var vals = ws.getRange(4, col, total - 3, 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) {
    var v = vals[i][0];
    if (v !== null && v !== undefined && v !== "" && v !== 0 && 
        v.toString().trim() !== "") {
      return i + 4;
    }
  }
  return 3;
}

function _getNextId(ws, prefix) {
  prefix = prefix || "INV";
  // If the sheet is missing or empty, start numbering at 0010
  if (!ws) return prefix + "-0010";

  var lastRow = ws.getLastRow();
  if (lastRow < 4) return prefix + "-0010";

  var data = ws.getRange(4, 1, lastRow - 3, 1).getValues();
  var max = 0;

  data.forEach(function(r) {
    var v = r[0] ? r[0].toString().trim() : "";
    if (v.toUpperCase().startsWith(prefix.toUpperCase() + "-")) {
      var n = parseInt(v.split("-").pop()) || 0;
      if (n > max) max = n;
    }
  });

  // Ensure the next ID is at least 0010
  var nextNum = max + 1;
  if (nextNum < 10) nextNum = 10;

  return prefix + "-" + String(nextNum).padStart(4, "0");
}





/*

  
  var lastRow = ws.getLastRow();
  if (lastRow < 4) return prefix + "-0001";
  
  var data = ws.getRange(4, 1, lastRow - 3, 1).getValues();
  var max = 0;
  
  data.forEach(function(r) {
    var v = r[0] ? r[0].toString().trim() : "";
    if (v.toUpperCase().startsWith(prefix.toUpperCase() + "-")) {
      var n = parseInt(v.split("-").pop()) || 0;
      if (n > max) max = n;
    }
  });
  
  return prefix + "-" + String(max + 1).padStart(4, "0");
*/

// Write a new invoice directly to INV_H and INV_I sheets.
// Replaces the legacy saveInvoice() call to avoid double-PDF generation.
function _writeInvoiceToSheet(ss, invId, d, total) {
  var invH = ss.getSheetByName(CFG.INV_H);
  if (!invH) throw new Error("Invoice Headers sheet not found");

  var hRow = _apiGetLastDataRow(invH, 1) + 1;
  if (hRow < 4) hRow = 4;

  var custName = d.custName || d.customerName || d.customer || d.custId || "";

  invH.getRange(hRow, 1, 1, 8).setValues([[
    invId,
    d.date || _today(),
    d.custId || "",
    custName,
    total,
    "Unpaid",
    d.payTerms || "COD",
    d.createdBy || "api"
  ]]);

  var invI = ss.getSheetByName(CFG.INV_I);
  if (!invI) throw new Error("Invoice Items sheet not found");

  var iRow = _apiGetLastDataRow(invI, 1) + 1;
  if (iRow < 4) iRow = 4;

  var itemRows = d.items.map(function(item) {
    var qty = parseFloat(item.qty) || 0;
    var rate = parseFloat(item.rate) || 0;
    return [invId, item.pid || "", item.pname || "", qty, rate, qty * rate, item.notes || ""];
  });

  if (itemRows.length > 0) {
    invI.getRange(iRow, 1, itemRows.length, 7).setValues(itemRows);
  }

  _ensureCustomerInAR(ss, d.custId);
  _recalcAR(ss, d.custId);
  _applyInventoryDelta(ss, d.items, 1);
  return "Invoice " + invId + " saved";
}

// Recompute AR (billed / paid / balance) for one customer from
// actual invoice + payment rows. Skips cells driven by sheet formulas.
function _recalcAR(ss, custId) {
  try {
    if (!custId) return;
    custId = custId.toString().trim();
    var arWs = ss.getSheetByName(CFG.AR);
    if (!arWs || arWs.getLastRow() < 4) return;

    var arData = arWs.getDataRange().getValues();
    var rowIdx = -1;
    for (var i = 3; i < arData.length; i++) {
      if (arData[i][0] && arData[i][0].toString().trim() === custId) {
        rowIdx = i + 1;
        break;
      }
    }
    if (rowIdx < 0) return;
    if (arWs.getRange(rowIdx, 4).getFormula()) return;

    var billed = 0;
    var invWs = ss.getSheetByName(CFG.INV_H);
    if (invWs && invWs.getLastRow() > 3) {
      invWs.getRange(4, 1, invWs.getLastRow() - 3, 6).getValues().forEach(function(r) {
        var status = r[5] ? r[5].toString().trim().toUpperCase() : "";
        if (r[2] && r[2].toString().trim() === custId && status !== "VOIDED") {
          billed += parseFloat(r[4]) || 0;
        }
      });
    }

    var paid = 0;
    var payWs = ss.getSheetByName(CFG.PAY);
    if (payWs && payWs.getLastRow() > 3) {
      payWs.getRange(4, 1, payWs.getLastRow() - 3, 7).getValues().forEach(function(r) {
        if (r[3] && r[3].toString().trim() === custId && r[2] === "Received") {
          paid += parseFloat(r[6]) || 0;
        }
      });
    }

    arWs.getRange(rowIdx, 4).setValue(billed);
    if (!arWs.getRange(rowIdx, 5).getFormula()) arWs.getRange(rowIdx, 5).setValue(paid);
    if (!arWs.getRange(rowIdx, 6).getFormula()) arWs.getRange(rowIdx, 6).setValue(billed - paid);
  } catch(e) {
    Logger.log("recalcAR error: " + e.message);
  }
}

// Merge duplicate Customer rows: re-point every invoice (INV_H col C) and customer
// payment (PAY col D) from each mergeId onto keepId, then remove the now-empty
// duplicate rows from Customers and AR so only the kept record remains.
// Captures a snapshot of everything it changes so the merge can be reversed later
// via _undoMergeCustomers.
function _mergeCustomers(ss, groups) {
  var custWs = ss.getSheetByName(CFG.CUST);
  var arWs   = ss.getSheetByName(CFG.AR);
  var invWs  = ss.getSheetByName(CFG.INV_H);
  var payWs  = ss.getSheetByName(CFG.PAY);
  var merged = 0, errors = [], snapshotGroups = [];

  groups.forEach(function(g) {
    try {
      var keepId = (g.keepId || "").toString().trim();
      var mergeIds = (g.mergeIds || []).map(function(x){ return x.toString().trim(); }).filter(function(x){ return x && x !== keepId; });
      if (!keepId || !mergeIds.length) return;
      var mergeSet = {};
      mergeIds.forEach(function(id){ mergeSet[id] = true; });

      // Snapshot the original Customer rows (full fields) before anything changes.
      var origById = {};
      if (custWs && custWs.getLastRow() > 3) {
        var snapData = custWs.getRange(4, 1, custWs.getLastRow() - 3, 8).getValues();
        snapData.forEach(function(r) {
          var rid = r[0] ? r[0].toString().trim() : "";
          if (mergeSet[rid]) {
            origById[rid] = {
              id: rid, name: r[1] || "", city: r[2] || "", area: r[3] || "",
              contact: r[4] || "", phone: r[5] || "", openBal: parseFloat(r[6]) || 0, notes: r[7] || "",
              invoiceIds: [], paymentIds: []
            };
          }
        });
      }

      // Re-point invoices (column C = custId) — record which invoice ids moved.
      if (invWs && invWs.getLastRow() > 3) {
        var invIds = invWs.getRange(4, 1, invWs.getLastRow() - 3, 1).getValues();
        var invData = invWs.getRange(4, 3, invWs.getLastRow() - 3, 1).getValues();
        for (var i = 0; i < invData.length; i++) {
          var v = invData[i][0] ? invData[i][0].toString().trim() : "";
          if (mergeSet[v]) {
            invWs.getRange(4 + i, 3).setValue(keepId);
            if (origById[v]) origById[v].invoiceIds.push(invIds[i][0] ? invIds[i][0].toString().trim() : "");
          }
        }
      }

      // Re-point customer payments (column D = partyId) — record which payment ids moved.
      if (payWs && payWs.getLastRow() > 3) {
        var payIds = payWs.getRange(4, 1, payWs.getLastRow() - 3, 1).getValues();
        var payData = payWs.getRange(4, 4, payWs.getLastRow() - 3, 1).getValues();
        for (var j = 0; j < payData.length; j++) {
          var pv = payData[j][0] ? payData[j][0].toString().trim() : "";
          if (mergeSet[pv]) {
            payWs.getRange(4 + j, 4).setValue(keepId);
            if (origById[pv]) origById[pv].paymentIds.push(payIds[j][0] ? payIds[j][0].toString().trim() : "");
          }
        }
      }

      // Remove the duplicate AR ledger rows (bottom-up so row indices stay valid).
      if (arWs && arWs.getLastRow() > 3) {
        var arData = arWs.getRange(4, 1, arWs.getLastRow() - 3, 1).getValues();
        for (var k = arData.length - 1; k >= 0; k--) {
          var av = arData[k][0] ? arData[k][0].toString().trim() : "";
          if (mergeSet[av]) arWs.deleteRow(4 + k);
        }
      }

      // Remove the duplicate Customers rows (bottom-up so row indices stay valid).
      if (custWs && custWs.getLastRow() > 3) {
        var custData = custWs.getRange(4, 1, custWs.getLastRow() - 3, 1).getValues();
        for (var m = custData.length - 1; m >= 0; m--) {
          var cv = custData[m][0] ? custData[m][0].toString().trim() : "";
          if (mergeSet[cv]) { custWs.deleteRow(4 + m); merged++; }
        }
      }

      _ensureCustomerInAR(ss, keepId);
      _recalcAR(ss, keepId);

      snapshotGroups.push({ keepId: keepId, removed: mergeIds.map(function(id){ return origById[id]; }).filter(Boolean) });
    } catch (e) {
      errors.push((g.keepId || "?") + ": " + e.message);
    }
  });

  return { merged: merged, errors: errors, snapshot: { groups: snapshotGroups } };
}

// Reverses _mergeCustomers using the snapshot it returned: re-inserts each removed
// customer's original row, re-points its specific invoice/payment ids back from
// keepId onto its own id, then recalculates AR for everyone involved.
function _undoMergeCustomers(ss, snapshot) {
  var custWs = ss.getSheetByName(CFG.CUST);
  var invWs  = ss.getSheetByName(CFG.INV_H);
  var payWs  = ss.getSheetByName(CFG.PAY);
  var restored = 0, errors = [];

  (snapshot.groups || []).forEach(function(g) {
    (g.removed || []).forEach(function(r) {
      try {
        if (custWs) {
          var row = _apiGetLastDataRow(custWs, 1) + 1;
          if (row < 4) row = 4;
          custWs.getRange(row, 1, 1, 8).setValues([[
            r.id, r.name || "", r.city || "", r.area || "",
            r.contact || "", r.phone || "", r.openBal || 0, r.notes || ""
          ]]);
        }

        if (invWs && invWs.getLastRow() > 3 && (r.invoiceIds || []).length) {
          var idSet = {};
          r.invoiceIds.forEach(function(id){ idSet[id] = true; });
          var invIdCol = invWs.getRange(4, 1, invWs.getLastRow() - 3, 1).getValues();
          for (var i = 0; i < invIdCol.length; i++) {
            var v = invIdCol[i][0] ? invIdCol[i][0].toString().trim() : "";
            if (idSet[v]) invWs.getRange(4 + i, 3).setValue(r.id);
          }
        }

        if (payWs && payWs.getLastRow() > 3 && (r.paymentIds || []).length) {
          var pidSet = {};
          r.paymentIds.forEach(function(id){ pidSet[id] = true; });
          var payIdCol = payWs.getRange(4, 1, payWs.getLastRow() - 3, 1).getValues();
          for (var j = 0; j < payIdCol.length; j++) {
            var pv = payIdCol[j][0] ? payIdCol[j][0].toString().trim() : "";
            if (pidSet[pv]) payWs.getRange(4 + j, 4).setValue(r.id);
          }
        }

        _ensureCustomerInAR(ss, r.id);
        _recalcAR(ss, r.id);
        restored++;
      } catch (e) {
        errors.push(r.id + ": " + e.message);
      }
    });
    _recalcAR(ss, g.keepId);
  });

  return { restored: restored, errors: errors };
}

// Look up a display name for a payment "party" id — tries Customers first, then Vendors.
function _lookupPartyName(ss, partyId) {
  if (!partyId) return "";
  partyId = partyId.toString().trim();

  var custWs = ss.getSheetByName(CFG.CUST);
  if (custWs && custWs.getLastRow() >= 4) {
    var cData = custWs.getRange(4, 1, custWs.getLastRow() - 3, 2).getValues();
    for (var i = 0; i < cData.length; i++) {
      if (cData[i][0] && cData[i][0].toString().trim() === partyId) {
        return cData[i][1] ? cData[i][1].toString().trim() : partyId;
      }
    }
  }

  var venWs = ss.getSheetByName(CFG.VEN);
  if (venWs && venWs.getLastRow() >= 4) {
    var vData = venWs.getRange(4, 1, venWs.getLastRow() - 3, 2).getValues();
    for (var j = 0; j < vData.length; j++) {
      if (vData[j][0] && vData[j][0].toString().trim() === partyId) {
        return vData[j][1] ? vData[j][1].toString().trim() : partyId;
      }
    }
  }

  return partyId;
}

// Append a row to the Payments sheet (col1=payId,col2=date,col3=type,
// col4=partyId,col5=partyName,col6=refId,col7=amount,col8=notes).
function savePayment(ss, obj) {
  var ws = ss.getSheetByName(CFG.PAY);
  if (!ws) throw new Error("Payments sheet not found");

  var row = _apiGetLastDataRow(ws, 1) + 1;
  if (row < 4) row = 4;

  ws.getRange(row, 1, 1, 8).setValues([[
    obj.payId,
    obj.date || _today(),
    obj.type || "Received",
    obj.partyId || "",
    _lookupPartyName(ss, obj.partyId),
    obj.refId || "",
    obj.amount || 0,
    obj.notes || ""
  ]]);

  return "Payment " + obj.payId + " saved";
}

// Append a row to the Expenses sheet (col1=expId,col2=date,col3=category,
// col4=desc/notes,col5=amount,col6=paidBy,col7=notes).
function saveExpense(ss, obj) {
  var ws = ss.getSheetByName(CFG.EXP);
  if (!ws) throw new Error("Expenses sheet not found");

  var row = _apiGetLastDataRow(ws, 1) + 1;
  if (row < 4) row = 4;

  ws.getRange(row, 1, 1, 7).setValues([[
    obj.expId,
    obj.date || _today(),
    obj.cat || "Misc",
    obj.desc || "",
    obj.amount || 0,
    obj.paidBy || "api",
    obj.notes || ""
  ]]);

  return "Expense " + obj.expId + " saved";
}

// Append a row to the Purchase Headers sheet (col1=purId,col2=date,
// col3=vendorId,col4=vendorName,col5=total,col6=paid,col7=notes).
function savePurchase(ss, obj) {
  var ws = ss.getSheetByName(CFG.PUR_H);
  if (!ws) throw new Error("Purchase Headers sheet not found");

  var row = _apiGetLastDataRow(ws, 1) + 1;
  if (row < 4) row = 4;

  var total = (obj.items || []).reduce(function(s, it) {
    return s + (parseFloat(it.total) || (parseFloat(it.qty) || 0) * (parseFloat(it.cost) || 0));
  }, 0);

  var venWs = ss.getSheetByName(CFG.VEN);
  var venName = obj.venId || "";
  if (venWs && venWs.getLastRow() >= 4) {
    var vData = venWs.getRange(4, 1, venWs.getLastRow() - 3, 2).getValues();
    for (var i = 0; i < vData.length; i++) {
      if (vData[i][0] && vData[i][0].toString().trim() === obj.venId) {
        venName = vData[i][1] ? vData[i][1].toString().trim() : obj.venId;
        break;
      }
    }
  }

  ws.getRange(row, 1, 1, 7).setValues([[
    obj.purId,
    obj.date || _today(),
    obj.venId || "",
    venName,
    total,
    0,
    obj.notes || ""
  ]]);

  return "Purchase " + obj.purId + " saved";
}

// Void an invoice in place: zero its total and mark it Voided so AR recalculation
// excludes it (mirrors the "Voided" status check already used by _recalcAR).
function voidInvoice(ss, invId) {
  var ws = ss.getSheetByName(CFG.INV_H);
  if (!ws) throw new Error("Invoice Headers sheet not found");

  var data = ws.getDataRange().getValues();
  for (var i = 3; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim().toUpperCase() === invId.toString().trim().toUpperCase()) {
      var alreadyVoid = (data[i][5] || "").toString().trim().toLowerCase() === "voided";
      ws.getRange(i + 1, 5).setValue(0);
      ws.getRange(i + 1, 6).setValue("Voided");
      // Return the voided invoice's units to stock (only once).
      if (!alreadyVoid) {
        _applyInventoryDelta(ss, _readInvoiceItems(ss, invId), -1);
      }
      return "Invoice " + invId + " voided";
    }
  }

  throw new Error(invId + " not found");
}

function _getNextCustomerId(ss) {
  ss = _getSs(ss);
  if (!ss) return "C-0001";

  var ws = ss.getSheetByName(CFG.CUST);
  if (!ws || ws.getLastRow() < 4) return "C-0001";

  var data = ws.getRange(4, 1, ws.getLastRow() - 3, 1).getValues();
  var max = 0;
  var rowCount = 0;

  data.forEach(function(r) {
    var raw = r[0];
    if (raw === null || raw === undefined || raw === "") return;
    rowCount++;
    var v = raw.toString().trim();

    // Strategy 1: C-001, C-089, C-0001 — same approach as _getNextId
    if (v.toUpperCase().startsWith("C-")) {
      var n = parseInt(v.split("-").pop()) || 0;
      if (n > max) max = n;
      return;
    }
    // Strategy 2: pure numeric IDs stored as numbers (Sheets custom format)
    if (/^\d+$/.test(v)) {
      var n = parseInt(v) || 0;
      if (n > max) max = n;
    }
  });

  // Fallback: if no C-style IDs found at all, base on row count
  if (max === 0 && rowCount > 0) max = rowCount;

  Logger.log("_getNextCustomerId: rowCount=" + rowCount + " max=" + max + " → C-" + String(max + 1).padStart(4, "0"));
  return "C-" + String(max + 1).padStart(4, "0");
}

// Run this function in Apps Script editor to verify customer ID generation
function testNextCustomerId() {
  var ss = _getSs();
  var nextId = _getNextCustomerId(ss);
  Logger.log("Next Customer ID will be: " + nextId);
  // Also log first 5 raw values from col A to diagnose format issues
  var ws = ss.getSheetByName(CFG.CUST);
  if (ws && ws.getLastRow() >= 4) {
    var sample = ws.getRange(4, 1, Math.min(5, ws.getLastRow() - 3), 1).getValues();
    sample.forEach(function(r, i) {
      Logger.log("Row " + (4 + i) + " col A: [" + typeof r[0] + "] " + JSON.stringify(r[0]));
    });
  }
}

// Run this in the Apps Script editor to verify every sheet is read correctly.
// Logs the row count for each entity and the detected header row + columns,
// so you can confirm the webapp's "all" payload is fully populated.
function testReadAll() {
  var ss = _getSs();
  if (!ss) { Logger.log("No spreadsheet"); return; }

  var counts = {
    customers: _readCustomers(ss).length,
    vendors:   _readVendors(ss).length,
    products:  _readProducts(ss).length,
    invoices:  _readInvoices(ss).length,
    purchases: _readPurchases(ss).length,
    payments:  _readPayments(ss).length,
    expenses:  _readExpenses(ss).length,
    ar:        _readAR(ss).length,
    ap:        _readAP(ss).length,
    inventory: _readInventory(ss).length
  };
  Logger.log("ROW COUNTS: " + JSON.stringify(counts, null, 2));

  // Show the header row each reader detected for the main sheets.
  var checks = [
    [CFG.CUST,  ["id", "name", "city", "area", "contact", "phone", "balance", "notes"]],
    [CFG.VEN,   ["id", "name", "category", "contact", "phone", "balance", "notes"]],
    [CFG.PROD,  ["id", "name", "category", "vendor", "cost", "price", "minstock"]],
    [CFG.INV_H, ["invoice", "date", "customer", "total", "status", "terms"]],
    [CFG.PAY,   ["payment", "date", "type", "party", "ref", "amount"]],
    [CFG.EXP,   ["expense", "date", "category", "amount"]],
    [CFG.AR,    ["customer", "billed", "paid", "balance"]],
    [CFG.AP,    ["vendor", "ordered", "paid", "balance"]],
    [CFG.INV_L, ["product", "cost", "purchased", "sold", "stock"]]
  ];
  checks.forEach(function(ch) {
    var ws = ss.getSheetByName(ch[0]);
    if (!ws) { Logger.log(ch[0] + ": SHEET NOT FOUND"); return; }
    var map = _headerMap(ws, ch[1]);
    Logger.log(ch[0] + " header columns: " + JSON.stringify(map));
  });
}

// ══════════════════════════════════════════════════════════
//  RESOLVE CUSTOMER NAME — NEW HELPER FUNCTION
// ══════════════════════════════════════════════════════════
function _resolveCustomerName(ss, custId, dataObj) {
  var custName = dataObj.custName || dataObj.customerName || 
                 dataObj.customer || "";
  
  if (!custName || custName === custId || custName.trim() === "") {
    try {
      var custWs = ss.getSheetByName(CFG.CUST);
      if (custWs) {
        var cData = custWs.getDataRange().getValues();
        for (var i = 3; i < cData.length; i++) {
          if (cData[i][0] && cData[i][0].toString().trim() === custId) {
            custName = cData[i][1] || custId;
            Logger.log("Customer name lookup: " + custId + " -> " + custName);
            break;
          }
        }
      }
    } catch(e) {
      Logger.log("Customer lookup error: " + e.message);
      custName = custId;
    }
  }
  
  if (!custName || custName.trim() === "") {
    custName = custId || "Customer";
  }
  
  return custName.toString().trim();
}

function _ensureCustomerInAR(ss, custId) {
  try {
    var arWs = ss.getSheetByName(CFG.AR);
    if (!arWs) return;
    
    var data = arWs.getDataRange().getValues();
    var found = false;
    
    for (var i = 3; i < data.length; i++) {
      if (data[i][0] && data[i][0].toString().trim() === custId) {
        found = true;
        break;
      }
    }
    
    if (!found) {
      var custWs = ss.getSheetByName(CFG.CUST);
      var custName = custId;
      
      if (custWs) {
        var cData = custWs.getDataRange().getValues();
        for (var i = 3; i < cData.length; i++) {
          if (cData[i][0] && cData[i][0].toString().trim() === custId) {
            custName = cData[i][1] || custId;
            break;
          }
        }
      }
      
      var newRow = _apiGetLastDataRow(arWs, 1) + 1;
      if (newRow < 4) newRow = 4;
      
      arWs.getRange(newRow, 1).setValue(custId);
      arWs.getRange(newRow, 2).setValue(custName);
    }
  } catch(e) {
    Logger.log("ensureCustomerInAR error: " + e.message);
  }
}

// ============================================================
//  READ FUNCTIONS
// ============================================================

function _lookupCustomer(ss, custId) {
  var ws = ss.getSheetByName(CFG.CUST);
  if (!ws) return null;
  var data = ws.getDataRange().getValues();
  for (var i = 3; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim() === custId) {
      return {
        name:    data[i][1] ? data[i][1].toString().trim() : "",
        area:    data[i][3] ? data[i][3].toString().trim() : "",
        contact: data[i][4] ? data[i][4].toString().trim() : "",
        phone:   data[i][5] ? data[i][5].toString().trim() : ""
      };
    }
  }
  return null;
}

// ════════════════════════════════════════════════════════════
//  HEADER-AWARE COLUMN MAPPING
//  Readers previously assumed fixed column positions (id=A, name=B…).
//  If a column is inserted/reordered in the Sheet, every field after it
//  shifts and reads blank/wrong data ("some data shows, some doesn't").
//  These helpers detect the header row and map each field by its column
//  name, falling back to the legacy fixed index so behaviour never
//  regresses when no header is found.
// ════════════════════════════════════════════════════════════
function _normHdr(s) {
  return (s == null ? "" : s.toString()).toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Scan the first 3 rows, pick the one that best matches the expected field
// keywords, and return { name -> zero-based column index }.
function _headerMap(ws, expectedKeys) {
  var lastCol = ws.getLastColumn();
  var lastRow = ws.getLastRow();
  if (lastCol < 1 || lastRow < 1) return {};
  var scanRows = Math.min(3, lastRow);
  var top = ws.getRange(1, 1, scanRows, lastCol).getValues();
  var keys = (expectedKeys || []).map(_normHdr);

  var bestIdx = -1, bestScore = -1;
  for (var i = 0; i < top.length; i++) {
    var score = 0;
    for (var c = 0; c < top[i].length; c++) {
      var n = _normHdr(top[i][c]);
      if (!n) continue;
      for (var k = 0; k < keys.length; k++) {
        if (keys[k] && (n.indexOf(keys[k]) !== -1 || keys[k].indexOf(n) !== -1)) { score++; break; }
      }
    }
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }

  var map = {};
  // Require at least 2 header matches before trusting the row — otherwise the
  // sheet has no usable header and we leave the map empty (pure fallback mode).
  if (bestIdx >= 0 && bestScore >= 2) {
    for (var ci = 0; ci < top[bestIdx].length; ci++) {
      var nn = _normHdr(top[bestIdx][ci]);
      if (nn && map[nn] == null) map[nn] = ci;
    }
  }
  return map;
}

// Resolve a field's column index: try each candidate header name (exact then
// contains), else use the legacy fixed fallback index.
function _col(map, candidates, fallback) {
  for (var i = 0; i < candidates.length; i++) {
    var n = _normHdr(candidates[i]);
    if (n && map[n] != null) return map[n];
  }
  for (var key in map) {
    for (var j = 0; j < candidates.length; j++) {
      var c = _normHdr(candidates[j]);
      if (c && (key.indexOf(c) !== -1 || c.indexOf(key) !== -1)) return map[key];
    }
  }
  return fallback;
}

function _readCustomers(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.CUST);
  if (!ws || ws.getLastRow() < 4) return [];

  var hm = _headerMap(ws, ["id", "name", "city", "area", "contact", "phone", "balance", "notes"]);
  var c = {
    id:      _col(hm, ["customerid", "custid", "id"], 0),
    name:    _col(hm, ["customername", "name", "store"], 1),
    city:    _col(hm, ["city"], 2),
    area:    _col(hm, ["area"], 3),
    contact: _col(hm, ["contactperson", "contact", "owner", "ownername"], 4),
    phone:   _col(hm, ["phone", "mobile", "contactno"], 5),
    openBal: _col(hm, ["openingbalance", "openbal", "balance"], 6),
    notes:   _col(hm, ["notes", "note", "remarks"], 7)
  };

  var data = ws.getRange(4, 1, ws.getLastRow() - 3, ws.getLastColumn()).getValues();
  var out = [];

  data.forEach(function(r) {
    if (!r[c.id] || !r[c.id].toString().trim()) return;
    out.push({
      id: r[c.id].toString().trim(),
      name: r[c.name] ? r[c.name].toString().trim() : "",
      city: r[c.city] ? r[c.city].toString().trim() : "",
      area: r[c.area] ? r[c.area].toString().trim() : "",
      contact: r[c.contact] ? r[c.contact].toString().trim() : "",
      phone: r[c.phone] ? r[c.phone].toString().trim() : "",
      openBal: parseFloat(r[c.openBal]) || 0,
      notes: r[c.notes] ? r[c.notes].toString().trim() : ""
    });
  });

  return out;
}

function _readVendors(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.VEN);
  if (!ws || ws.getLastRow() < 4) return [];

  var hm = _headerMap(ws, ["id", "name", "category", "contact", "phone", "balance", "notes"]);
  var c = {
    id:       _col(hm, ["vendorid", "venid", "id"], 0),
    name:     _col(hm, ["vendorname", "name"], 1),
    category: _col(hm, ["category", "type"], 2),
    contact:  _col(hm, ["contactperson", "contact", "owner"], 3),
    phone:    _col(hm, ["phone", "mobile", "contactno"], 4),
    openBal:  _col(hm, ["openingbalance", "openbal", "balance"], 5),
    notes:    _col(hm, ["notes", "note", "remarks"], 6)
  };

  var data = ws.getRange(4, 1, ws.getLastRow() - 3, ws.getLastColumn()).getValues();
  var out = [];

  data.forEach(function(r) {
    if (!r[c.id] || !r[c.id].toString().trim()) return;
    out.push({
      id: r[c.id].toString().trim(),
      name: r[c.name] ? r[c.name].toString().trim() : "",
      category: r[c.category] ? r[c.category].toString().trim() : "",
      contact: r[c.contact] ? r[c.contact].toString().trim() : "",
      phone: r[c.phone] ? r[c.phone].toString().trim() : "",
      openBal: parseFloat(r[c.openBal]) || 0,
      notes: r[c.notes] ? r[c.notes].toString().trim() : ""
    });
  });

  return out;
}

function _readProducts(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.PROD);
  if (!ws || ws.getLastRow() < 4) return [];

  var hm = _headerMap(ws, ["id", "name", "category", "vendor", "cost", "price", "minstock"]);
  var c = {
    id:       _col(hm, ["productid", "prodid", "pid", "id"], 0),
    name:     _col(hm, ["productname", "name", "description"], 1),
    category: _col(hm, ["category", "type"], 2),
    vendorId: _col(hm, ["vendorid", "venid", "vendor"], 3),
    cost:     _col(hm, ["cost", "costprice", "buyprice", "purchaseprice"], 5),
    price:    _col(hm, ["price", "saleprice", "tradeprice", "sellprice"], 6),
    minStock: _col(hm, ["minstock", "minimumstock", "reorder"], 8)
  };

  var data = ws.getRange(4, 1, ws.getLastRow() - 3, ws.getLastColumn()).getValues();
  var out = [];

  data.forEach(function(r) {
    if (!r[c.id] || !r[c.name]) return;
    out.push({
      id: r[c.id].toString().trim(),
      name: r[c.name].toString().trim(),
      category: r[c.category] ? r[c.category].toString().trim() : "",
      vendorId: r[c.vendorId] ? r[c.vendorId].toString().trim() : "",
      cost: parseFloat(r[c.cost]) || 0,
      price: parseFloat(r[c.price]) || 0,
      minStock: parseFloat(r[c.minStock]) || 0
    });
  });

  return out;
}

function _readInvoices(ss, limit) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.INV_H);
  if (!ws || ws.getLastRow() < 4) return [];
  
  var hm = _headerMap(ws, ["invoice", "date", "customer", "total", "status", "terms", "createdby"]);
  var mapped = {
    id:        _col(hm, ["invoiceid", "invid", "invoice", "id"], 0),
    date:      _col(hm, ["date"], 1),
    custId:    _col(hm, ["customerid", "custid"], 2),
    custName:  _col(hm, ["customername", "customer", "custname"], 3),
    total:     _col(hm, ["total", "amount", "grandtotal"], 4),
    status:    _col(hm, ["status"], 5),
    payTerms:  _col(hm, ["payterms", "paymentterms", "terms"], 6),
    createdBy: _col(hm, ["createdby", "creator", "by"], 7)
  };
  // Canonical layout used as a fallback when header detection misfires.
  var fixed = { id: 0, date: 1, custId: 2, custName: 3, total: 4, status: 5, payTerms: 6, createdBy: 7 };

  var lastRow = ws.getLastRow();
  var startRow = Math.max(4, lastRow - (limit || 300) + 1);
  var numRows = lastRow - startRow + 1;
  var data = ws.getRange(startRow, 1, numRows, ws.getLastColumn()).getValues();

  function build(c) {
    var rows = [];
    data.forEach(function(r) {
      if (r[c.id] === null || r[c.id] === undefined || r[c.id].toString().trim() === "") return;
      rows.push({
        id: r[c.id].toString().trim(),
        date: _fmtDate(r[c.date]),
        custId: r[c.custId] ? r[c.custId].toString().trim() : "",
        custName: r[c.custName] ? r[c.custName].toString().trim() : "",
        total: parseFloat(r[c.total]) || 0,
        status: r[c.status] ? r[c.status].toString().trim() : "Unpaid",
        payTerms: r[c.payTerms] ? r[c.payTerms].toString().trim() : "COD",
        createdBy: r[c.createdBy] ? r[c.createdBy].toString().trim() : "",
        ageDays: _daysSince(r[c.date])
      });
    });
    return rows;
  }

  var out = build(mapped);
  // FIX: if header-mapped columns produced no invoices but the sheet clearly
  // has data rows, the header scan picked the wrong id column and silently
  // skipped every row. Retry with the canonical fixed layout so invoices load.
  if (out.length === 0) {
    var anyData = data.some(function(r) {
      return r.join("").toString().trim() !== "";
    });
    if (anyData) out = build(fixed);
  }

  out.reverse();
  return out;
}

function _readInvoiceItems(ss, invId) {
  var ws = ss.getSheetByName(CFG.INV_I);
  if (!ws || ws.getLastRow() < 4) return [];

  var hm = _headerMap(ws, ["invoice", "product", "name", "qty", "rate", "total", "notes"]);
  var c = {
    invId: _col(hm, ["invoiceid", "invid", "invoice"], 0),
    pid:   _col(hm, ["productid", "prodid", "pid"], 1),
    pname: _col(hm, ["productname", "pname", "name", "description"], 2),
    qty:   _col(hm, ["qty", "quantity"], 3),
    rate:  _col(hm, ["rate", "price", "unitprice"], 4),
    total: _col(hm, ["total", "amount", "linetotal"], 5),
    notes: _col(hm, ["notes", "note", "remarks"], 6)
  };

  var data = ws.getRange(4, 1, ws.getLastRow() - 3, ws.getLastColumn()).getValues();
  var items = [];

  data.forEach(function(r) {
    if (!r[c.invId] || r[c.invId].toString().trim().toUpperCase() !== invId.toUpperCase()) {
      return;
    }
    items.push({
      invId: r[c.invId].toString().trim(),
      pid: r[c.pid] ? r[c.pid].toString().trim() : "",
      pname: r[c.pname] ? r[c.pname].toString().trim() : "",
      qty: parseFloat(r[c.qty]) || 0,
      rate: parseFloat(r[c.rate]) || 0,
      total: parseFloat(r[c.total]) || 0,
      notes: r[c.notes] ? r[c.notes].toString().trim() : ""
    });
  });

  return items;
}

function _readPurchases(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.PUR_H);
  if (!ws || ws.getLastRow() < 4) return [];

  var hm = _headerMap(ws, ["purchase", "date", "vendor", "total", "paid", "notes"]);
  var c = {
    id:       _col(hm, ["purchaseid", "purid", "purchase", "id"], 0),
    date:     _col(hm, ["date"], 1),
    vendorId: _col(hm, ["vendorid", "venid"], 2),
    vendor:   _col(hm, ["vendorname", "vendor"], 3),
    total:    _col(hm, ["total", "amount", "grandtotal"], 4),
    paid:     _col(hm, ["paid", "amountpaid"], 5),
    notes:    _col(hm, ["notes", "note", "remarks"], 6)
  };

  var data = ws.getRange(4, 1, ws.getLastRow() - 3, ws.getLastColumn()).getValues();
  var out = [];

  data.forEach(function(r) {
    if (!r[c.id]) return;
    out.push({
      id: r[c.id].toString().trim(),
      date: _fmtDate(r[c.date]),
      vendorId: r[c.vendorId] ? r[c.vendorId].toString().trim() : "",
      vendor: r[c.vendor] ? r[c.vendor].toString().trim() : "",
      total: parseFloat(r[c.total]) || 0,
      paid: parseFloat(r[c.paid]) || 0,
      notes: r[c.notes] ? r[c.notes].toString().trim() : ""
    });
  });

  out.reverse();
  return out;
}

function _readPayments(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.PAY);
  if (!ws || ws.getLastRow() < 4) return [];

  var hm = _headerMap(ws, ["payment", "date", "type", "party", "ref", "amount", "notes"]);
  var c = {
    id:        _col(hm, ["paymentid", "payid", "payment", "id"], 0),
    date:      _col(hm, ["date"], 1),
    type:      _col(hm, ["type", "paymenttype"], 2),
    partyId:   _col(hm, ["partyid", "customerid", "vendorid", "custid"], 3),
    partyName: _col(hm, ["partyname", "customername", "vendorname", "party", "name"], 4),
    refId:     _col(hm, ["refid", "reference", "invoiceid", "ref"], 5),
    amount:    _col(hm, ["amount", "total"], 6),
    notes:     _col(hm, ["notes", "note", "method", "remarks"], 7)
  };

  var data = ws.getRange(4, 1, ws.getLastRow() - 3, ws.getLastColumn()).getValues();
  var out = [];

  data.forEach(function(r) {
    if (!r[c.id]) return;
    out.push({
      id: r[c.id].toString().trim(),
      date: _fmtDate(r[c.date]),
      type: r[c.type] ? r[c.type].toString().trim() : "",
      partyId: r[c.partyId] ? r[c.partyId].toString().trim() : "",
      partyName: r[c.partyName] ? r[c.partyName].toString().trim() : "",
      refId: r[c.refId] ? r[c.refId].toString().trim() : "",
      amount: parseFloat(r[c.amount]) || 0,
      notes: r[c.notes] ? r[c.notes].toString().trim() : ""
    });
  });

  out.reverse();
  return out;
}

function _readExpenses(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.EXP);
  if (!ws || ws.getLastRow() < 4) return [];

  var hm = _headerMap(ws, ["expense", "date", "category", "notes", "amount", "by"]);
  var c = {
    id:       _col(hm, ["expenseid", "expid", "expense", "id"], 0),
    date:     _col(hm, ["date"], 1),
    category: _col(hm, ["category", "type"], 2),
    notes:    _col(hm, ["notes", "description", "desc", "note", "remarks"], 3),
    amount:   _col(hm, ["amount", "total"], 4),
    by:       _col(hm, ["paidby", "by", "creator", "createdby"], 5)
  };

  var data = ws.getRange(4, 1, ws.getLastRow() - 3, ws.getLastColumn()).getValues();
  var out = [];

  data.forEach(function(r) {
    if (!r[c.id]) return;
    out.push({
      id: r[c.id].toString().trim(),
      date: _fmtDate(r[c.date]),
      category: r[c.category] ? r[c.category].toString().trim() : "",
      notes: r[c.notes] ? r[c.notes].toString().trim() : "",
      amount: parseFloat(r[c.amount]) || 0,
      by: r[c.by] ? r[c.by].toString().trim() : ""
    });
  });

  out.reverse();
  return out;
}

function _readAR(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.AR);
  if (!ws || ws.getLastRow() < 4) return [];

  var hm = _headerMap(ws, ["customer", "city", "billed", "paid", "balance", "status"]);
  var c = {
    custId:      _col(hm, ["customerid", "custid", "id"], 0),
    custName:    _col(hm, ["customername", "customer", "name"], 1),
    city:        _col(hm, ["city", "area"], 2),
    totalBilled: _col(hm, ["totalbilled", "billed", "invoiced"], 3),
    totalPaid:   _col(hm, ["totalpaid", "paid", "received"], 4),
    balance:     _col(hm, ["balance", "outstanding", "due"], 5),
    status:      _col(hm, ["status"], 6)
  };

  var data = ws.getRange(4, 1, ws.getLastRow() - 3, ws.getLastColumn()).getValues();
  var out = [];

  data.forEach(function(r) {
    if (!r[c.custId]) return;
    out.push({
      custId: r[c.custId].toString().trim(),
      custName: r[c.custName] ? r[c.custName].toString().trim() : "",
      city: r[c.city] ? r[c.city].toString().trim() : "",
      totalBilled: parseFloat(r[c.totalBilled]) || 0,
      totalPaid: parseFloat(r[c.totalPaid]) || 0,
      balance: parseFloat(r[c.balance]) || 0,
      status: r[c.status] ? r[c.status].toString().trim() : ""
    });
  });

  return out;
}

function _readAP(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.AP);
  if (!ws || ws.getLastRow() < 4) return [];

  var hm = _headerMap(ws, ["vendor", "category", "ordered", "paid", "balance"]);
  var c = {
    vendorId:     _col(hm, ["vendorid", "venid", "id"], 0),
    vendorName:   _col(hm, ["vendorname", "vendor", "name"], 1),
    category:     _col(hm, ["category", "type"], 2),
    totalOrdered: _col(hm, ["totalordered", "ordered", "purchased", "billed"], 3),
    totalPaid:    _col(hm, ["totalpaid", "paid"], 4),
    balance:      _col(hm, ["balance", "outstanding", "due"], 5)
  };

  var data = ws.getRange(4, 1, ws.getLastRow() - 3, ws.getLastColumn()).getValues();
  var out = [];

  data.forEach(function(r) {
    if (!r[c.vendorId]) return;
    out.push({
      vendorId: r[c.vendorId].toString().trim(),
      vendorName: r[c.vendorName] ? r[c.vendorName].toString().trim() : "",
      category: r[c.category] ? r[c.category].toString().trim() : "",
      totalOrdered: parseFloat(r[c.totalOrdered]) || 0,
      totalPaid: parseFloat(r[c.totalPaid]) || 0,
      balance: parseFloat(r[c.balance]) || 0
    });
  });

  return out;
}

function _readInventory(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.INV_L);
  if (!ws || ws.getLastRow() < 4) return [];

  var hm = _headerMap(ws, ["product", "name", "category", "cost", "purchased", "sold", "returned", "stock", "minstock"]);
  var c = {
    pid:        _col(hm, ["productid", "prodid", "pid", "id"], 0),
    pname:      _col(hm, ["productname", "pname", "name", "description"], 1),
    category:   _col(hm, ["category", "type"], 2),
    cost:       _col(hm, ["cost", "costprice"], 3),
    purchased:  _col(hm, ["purchased", "totalpurchased", "bought"], 4),
    sold:       _col(hm, ["sold", "totalsold"], 5),
    returned:   _col(hm, ["returned", "salesreturned", "custreturned"], 6),
    prReturned: _col(hm, ["purchasereturned", "prreturned", "vendorreturned"], 7),
    stock:      _col(hm, ["currentstock", "stock", "instock", "balance"], 8),
    minStock:   _col(hm, ["minstock", "minimumstock", "reorder"], 9)
  };

  var data = ws.getRange(4, 1, ws.getLastRow() - 3, ws.getLastColumn()).getValues();
  var out = [];

  data.forEach(function(r) {
    if (!r[c.pid]) return;
    out.push({
      pid: r[c.pid].toString().trim(),
      pname: r[c.pname] ? r[c.pname].toString().trim() : "",
      category: r[c.category] ? r[c.category].toString().trim() : "",
      cost: parseFloat(r[c.cost]) || 0,
      purchased: parseFloat(r[c.purchased]) || 0,
      sold: parseFloat(r[c.sold]) || 0,
      returned: parseFloat(r[c.returned]) || 0,
      prReturned: parseFloat(r[c.prReturned]) || 0,
      stock: parseFloat(r[c.stock]) || 0,
      minStock: parseFloat(r[c.minStock]) || 0
    });
  });

  return out;
}

// Apply a stock movement for a set of invoice line items against Inventory_List.
//   dir = +1 → a sale: sold += qty, stock -= qty
//   dir = -1 → reverse a sale (void / delete / edit): sold -= qty, stock += qty
// Header-aware; products not present in Inventory_List are logged and skipped
// so an invoice operation is never blocked by a missing inventory row.
function _applyInventoryDelta(ss, items, dir) {
  ss = _getSs(ss);
  if (!ss || !items || !items.length) return;
  var ws = ss.getSheetByName(CFG.INV_L);
  if (!ws || ws.getLastRow() < 4) return;

  var hm = _headerMap(ws, ["product", "name", "category", "cost", "purchased", "sold", "returned", "stock", "minstock"]);
  var cPid  = _col(hm, ["productid", "prodid", "pid", "id"], 0);
  var cSold = _col(hm, ["sold", "totalsold"], 5);
  var cStk  = _col(hm, ["currentstock", "stock", "instock", "balance"], 8);

  var data = ws.getRange(4, 1, ws.getLastRow() - 3, ws.getLastColumn()).getValues();
  var index = {};
  for (var i = 0; i < data.length; i++) {
    var id = data[i][cPid];
    if (id !== null && id !== undefined && id.toString().trim() !== "") {
      index[id.toString().trim().toUpperCase()] = i;
    }
  }

  items.forEach(function(it) {
    var pid = (it.pid || it.product_id || "").toString().trim().toUpperCase();
    var qty = parseFloat(it.qty != null ? it.qty : it.quantity) || 0;
    if (!pid || !qty) return;
    var r = index[pid];
    if (r === undefined) { Logger.log("_applyInventoryDelta: product not in Inventory_List: " + pid); return; }
    var rowNum = r + 4;
    var sold  = parseFloat(data[r][cSold]) || 0;
    var stock = parseFloat(data[r][cStk]) || 0;
    ws.getRange(rowNum, cSold + 1).setValue(sold + dir * qty);
    ws.getRange(rowNum, cStk + 1).setValue(stock - dir * qty);
  });
}

// Manual stock adjustment (goods receipt / correction) since CRM purchases
// don't carry line items. delta > 0 adds stock (and to 'purchased'); delta < 0
// removes. Returns the new stock level.
function _adjustStock(ss, pid, delta) {
  ss = _getSs(ss);
  if (!ss) throw new Error("Spreadsheet not found");
  var ws = ss.getSheetByName(CFG.INV_L);
  if (!ws || ws.getLastRow() < 4) throw new Error("Inventory sheet not found");
  pid = (pid || "").toString().trim();
  delta = parseFloat(delta) || 0;
  if (!pid) throw new Error("Product id required");

  var hm = _headerMap(ws, ["product", "name", "category", "cost", "purchased", "sold", "returned", "stock", "minstock"]);
  var cPid  = _col(hm, ["productid", "prodid", "pid", "id"], 0);
  var cPur  = _col(hm, ["purchased", "totalpurchased", "bought"], 4);
  var cStk  = _col(hm, ["currentstock", "stock", "instock", "balance"], 8);

  var data = ws.getRange(4, 1, ws.getLastRow() - 3, ws.getLastColumn()).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][cPid] && data[i][cPid].toString().trim().toUpperCase() === pid.toUpperCase()) {
      var rowNum = i + 4;
      var stock = (parseFloat(data[i][cStk]) || 0) + delta;
      ws.getRange(rowNum, cStk + 1).setValue(stock);
      if (delta > 0) {
        var purchased = (parseFloat(data[i][cPur]) || 0) + delta;
        ws.getRange(rowNum, cPur + 1).setValue(purchased);
      }
      return { pid: pid, stock: stock };
    }
  }
  throw new Error("Product not found in Inventory_List: " + pid);
}

function _readDashboard(ss) {
  ss = _getSs(ss);
  if (!ss) {
    return {
      totalInvoiced: 0,
      totalReceived: 0,
      totalPurchases: 0,
      totalExpenses: 0,
      netProfit: 0,
      outstandingAR: 0
    };
  }
  
  var sheets = ss.getSheets();
  var cp = null;
  
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    if (name.indexOf("Control") !== -1 || name.indexOf("Panel") !== -1) {
      cp = sheets[i];
      break;
    }
  }
  
  if (!cp) cp = sheets[0];
  
  try {
    var snap = cp.getRange("D18:D23").getValues();
    return {
      totalInvoiced: snap[0][0] || 0,
      totalReceived: snap[1][0] || 0,
      totalPurchases: snap[2][0] || 0,
      totalExpenses: snap[3][0] || 0,
      netProfit: snap[4][0] || 0,
      outstandingAR: snap[5][0] || 0
    };
  } catch(e) {
    var invH = ss.getSheetByName(CFG.INV_H);
    var pay = ss.getSheetByName(CFG.PAY);
    var purH = ss.getSheetByName(CFG.PUR_H);
    var exp = ss.getSheetByName(CFG.EXP);
    
    var ti = 0, tr = 0, tp = 0, te = 0;
    
    if (invH && invH.getLastRow() > 3) {
      invH.getRange(4, 5, invH.getLastRow() - 3, 1).getValues()
        .forEach(function(r) { ti += parseFloat(r[0]) || 0; });
    }
    
    if (pay && pay.getLastRow() > 3) {
      var pd = pay.getRange(4, 1, pay.getLastRow() - 3, 7).getValues();
      pd.forEach(function(r) {
        if (r[2] === "Received") tr += parseFloat(r[6]) || 0;
      });
    }
    
    if (purH && purH.getLastRow() > 3) {
      purH.getRange(4, 5, purH.getLastRow() - 3, 1).getValues()
        .forEach(function(r) { tp += parseFloat(r[0]) || 0; });
    }
    
    if (exp && exp.getLastRow() > 3) {
      exp.getRange(4, 5, exp.getLastRow() - 3, 1).getValues()
        .forEach(function(r) { te += parseFloat(r[0]) || 0; });
    }
    
    return {
      totalInvoiced: ti,
      totalReceived: tr,
      totalPurchases: tp,
      totalExpenses: te,
      netProfit: (ti - tp - te),
      outstandingAR: (ti - tr)
    };
  }
}

function _readRiderJourney(ss, riderId) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var customers = _readCustomers(ss);
  var zones = {};
  
  customers.forEach(function(c) {
    var sec = typeof _detectZone !== "undefined" 
      ? _detectZone(c.area || "") 
      : {zone: "Other", day: ""};
    var z = sec.zone;
    
    if (!zones[z]) {
      zones[z] = {zone: z, day: sec.day, stores: []};
    }
    
    zones[z].stores.push({
      id: c.id,
      name: c.name,
      area: c.area,
      phone: c.phone
    });
  });
  
  return Object.values(zones);
}

function _readRiderOrders(ss, riderId) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var invoices = _readInvoices(ss, 100);
  
  return invoices.filter(function(i) {
    return i.status === "Unpaid" || i.status === "Partial";
  }).slice(0, 50);
}

// ============================================================
//  PDF GENERATION FUNCTIONS — FIXED WITH LOGO & PKR
// ============================================================

function _findPdfInDrive(invId) {
  try {
    var folder = DriveApp.getFolderById(API_CFG.DRIVE_FOLDER);
    var files = folder.getFilesByName(invId);
    
    if (files.hasNext()) {
      return files.next().getUrl();
    }
    
    var allFiles = folder.getFiles();
    while (allFiles.hasNext()) {
      var f = allFiles.next();
      if (f.getName().indexOf(invId) !== -1) {
        return f.getUrl();
      }
    }
  } catch(e) {
    Logger.log("findPdfInDrive error: " + e.message);
  }
  
  return null;
}

function _generatePdfForInvoice(ss, invId) {
  ss = _getSs(ss);
  if (!ss) return null;
  
  var invH = ss.getSheetByName(CFG.INV_H);
  var invI = ss.getSheetByName(CFG.INV_I);
  
  if (!invH || !invI) return null;

  var hData = invH.getDataRange().getValues();
  var inv = null;
  
  for (var i = 3; i < hData.length; i++) {
    if (hData[i][0] && 
        hData[i][0].toString().trim().toUpperCase() === invId.toUpperCase()) {
      inv = hData[i];
      break;
    }
  }
  
  if (!inv) return null;

  var items = _readInvoiceItems(ss, invId);
  if (!items.length) return null;

  var custName = inv[3] || inv[2];
  if (!custName || custName === inv[2]) {
    custName = _resolveCustomerName(ss, inv[2], {});
  }

  var custRecord = _lookupCustomer(ss, inv[2]);
  var d = {
    invId: invId,
    date: _fmtDate(inv[1]),
    custId: inv[2] || "",
    custName: custName,
    customerName: custName,
    customer: custName,
    custArea:    custRecord ? custRecord.area    : "",
    custContact: custRecord ? custRecord.contact : "",
    custPhone:   custRecord ? custRecord.phone   : "",
    payTerms: inv[6] || "COD",
    notes: "Thank you for your business.",
    tax: 0,
    items: items
  };
  
  var total = items.reduce(function(s, i) {
    return s + i.total;
  }, 0);

  try {
    return _customGeneratePDF(d, total);
  } catch(e) {
    Logger.log("generatePdfForInvoice error: " + e.message);
    return null;
  }
}

// ══════════════════════════════════════════════════════════
//  CUSTOM GENERATE PDF — WITH LOGO, PKR CURRENCY & INV NUMBER
// ══════════════════════════════════════════════════════════
function _customGeneratePDF(d, total) {
  try {
    var custName = d.custName || d.customerName || d.customer || 
                   d.custId || "Customer";
    custName = custName.toString().trim();
    
    // ✅ CRITICAL: Use the invoice ID that was passed in
    var invId = d.invId.toString().trim();
    
    Logger.log("=== PDF Generation ===");
    Logger.log("Invoice ID: " + invId);
    Logger.log("Customer: " + custName);
    Logger.log("Date: " + (d.date || _today()));
    
    // ✅ Build payload with logo, PKR currency, and correct invoice number
    var payload = {
      // ✅ Logo (must be publicly accessible URL)
      logo: API_CFG.LOGO_URL || "",
      
      // Company info
      from: "Assorted Produce Traders\nFF 27, Zarpar Arcade\nD-12 Markaz, Islamabad\n+92 342 2221633",
      
      // Customer info — store name, purchaser, area
      to: (function() {
        var lines = [custName];
        var contact = (d.custContact || "").trim();
        var phone   = (d.custPhone   || "").trim();
        var area    = (d.custArea    || "").trim();
        if (contact || phone) {
          lines.push(contact + (contact && phone ? " · " : "") + phone);
        }
        if (area) lines.push(area);
        return lines.join("\n");
      })(),
      
      // ✅ Invoice number - THIS IS THE KEY FIELD
      number: invId,
      
      // Date
      date: d.date || _today(),
      
      // Payment terms
      payment_terms: d.payTerms || "COD",
      
      // Notes
      notes: d.notes || "Thank you for your business.",
      
      // ✅ Currency - Set to PKR (Pakistani Rupees)
      currency: "PKR",
      
      // Items
      items: d.items.map(function(item) {
        return {
          name: item.pname || item.pid || "Item",
          quantity: parseFloat(item.qty) || 0,
          unit_cost: parseFloat(item.rate) || 0
        };
      }),
      
      // Tax
      tax: d.tax || 0,
      
      // Field labels
      fields: {
        tax: "%"
      }
    };

    Logger.log("Payload: " + JSON.stringify(payload, null, 2));

    // ✅ Call invoice-generator.com API
    var options = {
      method: "POST",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    if (API_CFG.INV_API_KEY) {
      options.headers = {
        "Authorization": "Bearer " + API_CFG.INV_API_KEY
      };
    }

    Logger.log("Calling invoice-generator.com...");
    var response = UrlFetchApp.fetch("https://invoice-generator.com", options);
    
    if (response.getResponseCode() !== 200) {
      throw new Error("PDF API failed: " + response.getContentText());
    }

    // ✅ Save to Drive with correct filename
    var fileName = custName + " - " + invId + ".pdf";
    var blob = response.getBlob().setName(fileName);
    var folder = DriveApp.getFolderById(API_CFG.DRIVE_FOLDER);
    
    // Clean up old files with same invoice ID
    var oldFiles = folder.searchFiles("title contains '" + invId + "'");
    while (oldFiles.hasNext()) {
      try {
        oldFiles.next().setTrashed(true);
      } catch(ex) {}
    }

    // Create new file
    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    
    var url = file.getUrl();
    Logger.log("✓ PDF created successfully: " + url);
    Logger.log("✓ Filename: " + fileName);
    
    return url;
  } catch(e) {
    Logger.log("✗ customGeneratePDF error: " + e.message + "\n" + e.stack);
    return "";
  }
}

function _renamePdfFile(invId, custName) {
  try {
    var folder = DriveApp.getFolderById(API_CFG.DRIVE_FOLDER);
    var files = folder.searchFiles("title contains '" + invId + "'");
    
    while (files.hasNext()) {
      var f = files.next();
      var name = f.getName();
      var cleanName = (custName || "Customer") + " - " + invId + ".pdf";
      
      if (name !== cleanName) {
        f.setName(cleanName);
        Logger.log("Renamed PDF: " + name + " -> " + cleanName);
      }
    }
  } catch(e) {
    Logger.log("Rename failed: " + e.message);
  }
}

// ============================================================
//  ADDITIONAL FUNCTIONS
// ============================================================

function _updateInvoiceStatus(ss, invId, amtReceived) {
  ss = _getSs(ss);
  if (!ss) return;
  
  var ws = ss.getSheetByName(CFG.INV_H);
  if (!ws) return;
  
  var data = ws.getLastRow() < 4 
    ? [] 
    : ws.getRange(4, 1, ws.getLastRow() - 3, 6).getValues();
  
  var payWs = ss.getSheetByName(CFG.PAY);
  var totalPaid = amtReceived;
  
  if (payWs && payWs.getLastRow() > 3) {
    var pData = payWs.getRange(4, 1, payWs.getLastRow() - 3, 7).getValues();
    pData.forEach(function(p) {
      if (p[5] && p[5].toString().trim() === invId && p[2] === "Received") {
        totalPaid += parseFloat(p[6]) || 0;
      }
    });
  }
  
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] && 
        data[i][0].toString().trim().toUpperCase() === invId.toUpperCase()) {
      var total = parseFloat(data[i][4]) || 0;
      var status = totalPaid >= total 
        ? "Paid" 
        : totalPaid > 0 
          ? "Partial" 
          : "Unpaid";
      ws.getRange(i + 4, 6).setValue(status);
      return;
    }
  }
}

function _findInvoiceCustId(ss, invId) {
  try {
    var ws = ss.getSheetByName(CFG.INV_H);
    if (!ws || ws.getLastRow() < 4) return "";
    var data = ws.getRange(4, 1, ws.getLastRow() - 3, 3).getValues();
    for (var i = 0; i < data.length; i++) {
      if (data[i][0] &&
          data[i][0].toString().trim().toUpperCase() === invId.toString().trim().toUpperCase()) {
        return data[i][2] ? data[i][2].toString().trim() : "";
      }
    }
  } catch(e) {
    Logger.log("findInvoiceCustId error: " + e.message);
  }
  return "";
}

function _deleteInvoice(ss, invId) {
  if (!invId) return "Error: No Invoice ID provided";
  
  ss = _getSs(ss);
  if (!ss) return "Error: Spreadsheet not found";
  
  // Return units to stock before the rows are gone — but only if the invoice
  // wasn't already Voided (voiding already reversed it).
  var wasVoided = false;
  var sheetHchk = ss.getSheetByName(CFG.INV_H);
  if (sheetHchk) {
    var chk = sheetHchk.getDataRange().getValues();
    for (var ci = 3; ci < chk.length; ci++) {
      if (chk[ci][0] && chk[ci][0].toString().trim().toUpperCase() === invId.toUpperCase()) {
        wasVoided = (chk[ci][5] || "").toString().trim().toLowerCase() === "voided";
        break;
      }
    }
  }
  if (!wasVoided) {
    _applyInventoryDelta(ss, _readInvoiceItems(ss, invId), -1);
  }

  var sheetH = ss.getSheetByName(CFG.INV_H);
  if (sheetH) {
    var dataH = sheetH.getDataRange().getValues();
    for (var i = dataH.length - 1; i >= 3; i--) {
      if (dataH[i][0] &&
          dataH[i][0].toString().trim().toUpperCase() === invId.toUpperCase()) {
        sheetH.deleteRow(i + 1);
      }
    }
  }
  
  var sheetI = ss.getSheetByName(CFG.INV_I);
  if (sheetI) {
    var dataI = sheetI.getDataRange().getValues();
    for (var i = dataI.length - 1; i >= 3; i--) {
      if (dataI[i][0] && 
          dataI[i][0].toString().trim().toUpperCase() === invId.toUpperCase()) {
        sheetI.deleteRow(i + 1);
      }
    }
  }

  var sheetPay = ss.getSheetByName(CFG.PAY);
  if (sheetPay) {
    var dataPay = sheetPay.getDataRange().getValues();
    for (var i = dataPay.length - 1; i >= 3; i--) {
      if (dataPay[i][5] && 
          dataPay[i][5].toString().trim().toUpperCase() === invId.toUpperCase()) {
        sheetPay.deleteRow(i + 1);
      }
    }
  }

  return "Invoice " + invId + " and associated items/payments deleted";
}