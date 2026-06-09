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

        // Step 2: Resolve Customer Name
        var custName = _resolveCustomerName(ss, d.custId, d);
        d.custName = custName;
        d.customerName = custName;
        d.customer = custName;
        Logger.log("✓ Resolved Customer Name: " + custName);

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
        var result = saveExpense({
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
        
        var result = savePayment({
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
        
        var result = savePurchase({
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
        var d = body.data;
        if (!d || !d.name) return _apiErr("Missing name");
        
        var ws = ss.getSheetByName(CFG.CUST);
        var newId = _getNextCustomerId(ss);
        var row = _apiGetLastDataRow(ws, 1) + 1;
        if (row < 4) row = 4;
        
        ws.getRange(row, 1).setValue(newId);
        ws.getRange(row, 2).setValue(d.name);
        ws.getRange(row, 3).setValue(d.city || "ISB");
        ws.getRange(row, 4).setValue(d.area || "");
        ws.getRange(row, 5).setValue(d.contact || "");
        ws.getRange(row, 6).setValue(d.phone || "");
        ws.getRange(row, 7).setValue(parseFloat(d.openBal) || 0);
        ws.getRange(row, 8).setValue(d.notes || "");
        
        _ensureCustomerInAR(ss, newId);
        
        return _apiOk({
          id: newId,
          message: "Customer " + newId + " added: " + d.name
        });
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
        var d = body.data;
        if (!d || !d.custId || !d.items || !d.items.length) {
          return _apiErr("Missing custId or items");
        }
        
        // Generate invoice ID
        var invId = _getNextId(ss.getSheetByName(CFG.INV_H), "INV");
        d.invId = invId;

        // Resolve customer name
        var custName = _resolveCustomerName(ss, d.custId, d);
        d.custName = custName;
        d.customerName = custName;
        d.customer = custName;

        d.createdBy = body.riderId || "rider";
        d.payTerms = d.payTerms || "COD";
        d.notes = "[Rider App] " + (d.notes || "");

        var total = d.items.reduce(function(s, i) {
          return s + ((parseFloat(i.qty) || 0) * (parseFloat(i.rate) || 0));
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
          pdfUrl: pdfUrl
        });
      }

      // ══════════════════════════════════════════════════════
      //  VOID INVOICE
      // ══════════════════════════════════════════════════════
      case "void_invoice": {
        var invId = body.invId;
        if (!invId) return _apiErr("Missing invId");
        
        var result = voidInvoice(invId);
        return _apiOk({ message: result });
      }

      // ══════════════════════════════════════════════════════
      //  DELETE INVOICE
      // ══════════════════════════════════════════════════════
      case "delete_invoice": {
        var invId = body.invId;
        if (!invId) return _apiErr("Missing invId");
        
        var result = _deleteInvoice(ss, invId);
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
  return "Invoice " + invId + " saved";
}

function _getNextCustomerId(ss) {
  ss = _getSs(ss);
  if (!ss) return "C-0001";

  var ws = ss.getSheetByName(CFG.CUST);
  if (!ws || ws.getLastRow() < 4) return "C-0001";

  var data = ws.getRange(4, 1, ws.getLastRow() - 3, 1).getValues();
  var max = 0;

  data.forEach(function(r) {
    var v = r[0] ? r[0].toString().trim() : "";
    if (v.match(/^C-\d+$/i)) {
      var n = parseInt(v.replace(/^C-/i, "")) || 0;
      if (n > max) max = n;
    }
  });

  return "C-" + String(max + 1).padStart(4, "0");
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

function _readCustomers(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.CUST);
  if (!ws || ws.getLastRow() < 4) return [];
  
  var data = ws.getRange(4, 1, ws.getLastRow() - 3, 8).getValues();
  var out = [];
  
  data.forEach(function(r) {
    if (!r[0] || !r[0].toString().trim()) return;
    out.push({
      id: r[0].toString().trim(),
      name: r[1] ? r[1].toString().trim() : "",
      city: r[2] ? r[2].toString().trim() : "",
      area: r[3] ? r[3].toString().trim() : "",
      contact: r[4] ? r[4].toString().trim() : "",
      phone: r[5] ? r[5].toString().trim() : "",
      openBal: parseFloat(r[6]) || 0,
      notes: r[7] ? r[7].toString().trim() : ""
    });
  });
  
  return out;
}

function _readVendors(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.VEN);
  if (!ws || ws.getLastRow() < 4) return [];
  
  var data = ws.getRange(4, 1, ws.getLastRow() - 3, 8).getValues();
  var out = [];
  
  data.forEach(function(r) {
    if (!r[0] || !r[0].toString().trim()) return;
    out.push({
      id: r[0].toString().trim(),
      name: r[1] ? r[1].toString().trim() : "",
      category: r[2] ? r[2].toString().trim() : "",
      contact: r[3] ? r[3].toString().trim() : "",
      phone: r[4] ? r[4].toString().trim() : "",
      openBal: parseFloat(r[5]) || 0,
      notes: r[6] ? r[6].toString().trim() : ""
    });
  });
  
  return out;
}

function _readProducts(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.PROD);
  if (!ws || ws.getLastRow() < 4) return [];
  
  var numCols = Math.min(ws.getLastColumn(), 9);
  var data = ws.getRange(4, 1, ws.getLastRow() - 3, numCols).getValues();
  var out = [];
  
  data.forEach(function(r) {
    if (!r[0] || !r[1]) return;
    out.push({
      id: r[0].toString().trim(),
      name: r[1].toString().trim(),
      category: r[2] ? r[2].toString().trim() : "",
      vendorId: r[3] ? r[3].toString().trim() : "",
      cost: parseFloat(r[5]) || 0,
      price: parseFloat(r[6]) || 0,
      minStock: parseFloat(r[8]) || 0
    });
  });
  
  return out;
}

function _readInvoices(ss, limit) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.INV_H);
  if (!ws || ws.getLastRow() < 4) return [];
  
  var lastRow = ws.getLastRow();
  var startRow = Math.max(4, lastRow - (limit || 300) + 1);
  var numRows = lastRow - startRow + 1;
  var data = ws.getRange(startRow, 1, numRows, 8).getValues();
  var out = [];
  
  data.forEach(function(r) {
    if (!r[0]) return;
    out.push({
      id: r[0].toString().trim(),
      date: _fmtDate(r[1]),
      custId: r[2] ? r[2].toString().trim() : "",
      custName: r[3] ? r[3].toString().trim() : "",
      total: parseFloat(r[4]) || 0,
      status: r[5] ? r[5].toString().trim() : "Unpaid",
      payTerms: r[6] ? r[6].toString().trim() : "COD",
      createdBy: r[7] ? r[7].toString().trim() : ""
    });
  });
  
  out.reverse();
  return out;
}

function _readInvoiceItems(ss, invId) {
  var ws = ss.getSheetByName(CFG.INV_I);
  if (!ws || ws.getLastRow() < 4) return [];
  
  var data = ws.getRange(4, 1, ws.getLastRow() - 3, 7).getValues();
  var items = [];
  
  data.forEach(function(r) {
    if (!r[0] || r[0].toString().trim().toUpperCase() !== invId.toUpperCase()) {
      return;
    }
    items.push({
      invId: r[0].toString().trim(),
      pid: r[1] ? r[1].toString().trim() : "",
      pname: r[2] ? r[2].toString().trim() : "",
      qty: parseFloat(r[3]) || 0,
      rate: parseFloat(r[4]) || 0,
      total: parseFloat(r[5]) || 0,
      notes: r[6] ? r[6].toString().trim() : ""
    });
  });
  
  return items;
}

function _readPurchases(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.PUR_H);
  if (!ws || ws.getLastRow() < 4) return [];
  
  var data = ws.getRange(4, 1, ws.getLastRow() - 3, 7).getValues();
  var out = [];
  
  data.forEach(function(r) {
    if (!r[0]) return;
    out.push({
      id: r[0].toString().trim(),
      date: _fmtDate(r[1]),
      vendorId: r[2] ? r[2].toString().trim() : "",
      vendor: r[3] ? r[3].toString().trim() : "",
      total: parseFloat(r[4]) || 0,
      paid: parseFloat(r[5]) || 0,
      notes: r[6] ? r[6].toString().trim() : ""
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
  
  var data = ws.getRange(4, 1, ws.getLastRow() - 3, 8).getValues();
  var out = [];
  
  data.forEach(function(r) {
    if (!r[0]) return;
    out.push({
      id: r[0].toString().trim(),
      date: _fmtDate(r[1]),
      type: r[2] ? r[2].toString().trim() : "",
      partyId: r[3] ? r[3].toString().trim() : "",
      partyName: r[4] ? r[4].toString().trim() : "",
      refId: r[5] ? r[5].toString().trim() : "",
      amount: parseFloat(r[6]) || 0,
      notes: r[7] ? r[7].toString().trim() : ""
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
  
  var data = ws.getRange(4, 1, ws.getLastRow() - 3, 7).getValues();
  var out = [];
  
  data.forEach(function(r) {
    if (!r[0]) return;
    out.push({
      id: r[0].toString().trim(),
      date: _fmtDate(r[1]),
      category: r[2] ? r[2].toString().trim() : "",
      notes: r[3] ? r[3].toString().trim() : "",
      amount: parseFloat(r[4]) || 0,
      by: r[5] ? r[5].toString().trim() : ""
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
  
  var data = ws.getRange(4, 1, ws.getLastRow() - 3, 7).getValues();
  var out = [];
  
  data.forEach(function(r) {
    if (!r[0]) return;
    out.push({
      custId: r[0].toString().trim(),
      custName: r[1] ? r[1].toString().trim() : "",
      city: r[2] ? r[2].toString().trim() : "",
      totalBilled: parseFloat(r[3]) || 0,
      totalPaid: parseFloat(r[4]) || 0,
      balance: parseFloat(r[5]) || 0,
      status: r[6] ? r[6].toString().trim() : ""
    });
  });
  
  return out;
}

function _readAP(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.AP);
  if (!ws || ws.getLastRow() < 4) return [];
  
  var data = ws.getRange(4, 1, ws.getLastRow() - 3, 6).getValues();
  var out = [];
  
  data.forEach(function(r) {
    if (!r[0]) return;
    out.push({
      vendorId: r[0].toString().trim(),
      vendorName: r[1] ? r[1].toString().trim() : "",
      category: r[2] ? r[2].toString().trim() : "",
      totalOrdered: parseFloat(r[3]) || 0,
      totalPaid: parseFloat(r[4]) || 0,
      balance: parseFloat(r[5]) || 0
    });
  });
  
  return out;
}

function _readInventory(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  
  var ws = ss.getSheetByName(CFG.INV_L);
  if (!ws || ws.getLastRow() < 4) return [];
  
  var data = ws.getRange(4, 1, ws.getLastRow() - 3, 10).getValues();
  var out = [];
  
  data.forEach(function(r) {
    if (!r[0]) return;
    out.push({
      pid: r[0].toString().trim(),
      pname: r[1] ? r[1].toString().trim() : "",
      category: r[2] ? r[2].toString().trim() : "",
      cost: parseFloat(r[3]) || 0,
      purchased: parseFloat(r[4]) || 0,
      sold: parseFloat(r[5]) || 0,
      returned: parseFloat(r[6]) || 0,
      prReturned: parseFloat(r[7]) || 0,
      stock: parseFloat(r[8]) || 0,
      minStock: parseFloat(r[9]) || 0
    });
  });
  
  return out;
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

  var d = {
    invId: invId,
    date: _fmtDate(inv[1]),
    custId: inv[2] || "",
    custName: custName,
    customerName: custName,
    customer: custName,
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
      
      // Customer info
      to: custName,
      
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

function _deleteInvoice(ss, invId) {
  if (!invId) return "Error: No Invoice ID provided";
  
  ss = _getSs(ss);
  if (!ss) return "Error: Spreadsheet not found";
  
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