// ============================================================
//  APT ERP — GAS REST API v2.0
//  ADD THIS AS A SEPARATE FILE in Apps Script (File → New → Script)
//  Name it: "z_API"
//
//  Works alongside your existing APT_RiderApp_v5.0.gs
//  Does NOT replace or modify any existing function.
//
//  New in v2:
//  - save_invoice now calls your existing saveInvoice() + _generatePDF()
//  - Returns pdfUrl so CRM can show download button
//  - pdf_download action returns Drive file download link
//  - rider_orders endpoint for Rider App sync
//  - mark_paid updates invoice status in sheet
// ============================================================

var API_CFG = {
  SHEET_ID:    "1-L73aqBLjapsE53MTnYkJ2HvRjYlql-wM1QjgPvLs_w",
  API_KEY:     "APT_SECRET_2025",          // Must match VITE_API_KEY in Vercel
  DRIVE_FOLDER:"1cCU3BBUbHE1YeTTxxOGJztMtpqplQ8sk", // Your APT Invoice PDFs folder
  INV_API_KEY: "sk_pXxXFBgSwoyZH1IgBusintr96QQYIoYH", // invoice-generator.com
  TZ:          "Asia/Karachi",
};

// ── SAFE CFG FALLBACK ────────────────────────────────────────
// If CFG is not defined globally (e.g. in a standalone project),
// we define it here so the script works independently and won't crash!
if (typeof CFG === "undefined") {
  var CFG = {
    SHEET_ID:     API_CFG.SHEET_ID,
    API_KEY:      API_CFG.API_KEY,
    DRIVE_FOLDER: API_CFG.DRIVE_FOLDER,
    INV_API_KEY:  API_CFG.INV_API_KEY,
    TZ:           API_CFG.TZ,
    
    // Sheet Names mapping
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
  // Google Apps Script handles CORS automatically via redirects from script.google.com
  // to script.googleusercontent.com when returning ContentService output.
  // Calling .setHeader() on a TextOutput object throws a TypeError, causing a 500 HTML error page.
  return out;
}
function _apiJson(obj) {
  return _apiCors(ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON));
}
function _apiOk(data)       { return _apiJson({ success:true,  data:data  }); }
function _apiErr(msg, code) { return _apiJson({ success:false, error:msg, code:code||400 }); }

function _apiAuth(e) {
  try {
    var k = (e.parameter && e.parameter.key) ||
            (e.postData  && JSON.parse(e.postData.contents||"{}").key) || "";
    return k === API_CFG.API_KEY;
  } catch(ex) { return false; }
}

// ── OPTIONS preflight (CORS) ─────────────────────────────────
function doOptions(e) {
  return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT);
}

// ============================================================
//  doGet — READ
// ============================================================
function doGet(e) {
  e = e || {};
  if (!_apiAuth(e)) return _apiErr("Unauthorized", 401);
  var action = (e.parameter && e.parameter.action) || "dashboard";
  var ss = _getSs();
  if (!ss) return _apiErr("Spreadsheet not found or inaccessible. Please verify SHEET_ID.", 500);

  try {
    switch (action) {

      // ── All data in one call ───────────────────────────────
      case "all": {
        var customers  = _readCustomers(ss);
        var vendors    = _readVendors(ss);
        var products   = _readProducts(ss);
        var invoices   = _readInvoices(ss, parseInt(e.parameter.limit)||300);
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
        var ws = ss.getSheetByName(CFG.INV_I);
        if (!ws) return _apiErr("06_Invoice_Items not found");
        var data = ws.getLastRow()<4 ? [] : ws.getRange(4,1,ws.getLastRow()-3,7).getValues();
        var items = [];
        data.forEach(function(r){
          if (!r[0]||r[0].toString().trim().toUpperCase()!==invId.toUpperCase()) return;
          items.push({invId:r[0].toString().trim(),pid:r[1]?r[1].toString().trim():"",pname:r[2]?r[2].toString().trim():"",qty:parseFloat(r[3])||0,rate:parseFloat(r[4])||0,total:parseFloat(r[5])||0,notes:r[6]?r[6].toString().trim():""});
        });
        return _apiOk(items);
      }

      // ── Get PDF URL for an invoice ─────────────────────────
      case "pdf_url": {
        var invId = e.parameter.id;
        if (!invId) return _apiErr("id required");
        var url = _findPdfInDrive(invId);
        if (url) return _apiOk({ url:url, found:true });
        // Generate on demand
        var pdfUrl = _generatePdfForInvoice(ss, invId);
        return _apiOk({ url:pdfUrl, found:!!pdfUrl });
      }

      // ── Rider journey plan ─────────────────────────────────
      case "rider_journey": {
        var riderId = e.parameter.rider || "";
        return _apiOk(_readRiderJourney(ss, riderId));
      }

      // ── Rider pending orders ───────────────────────────────
      case "rider_orders": {
        var riderId = e.parameter.rider || "";
        return _apiOk(_readRiderOrders(ss, riderId));
      }

      default: return _apiErr("Unknown action: " + action);
    }
  } catch(err) {
    return _apiErr("Server error: " + err.message + " | Stack: " + (err.stack||"").substring(0,200), 500);
  }
}

// ============================================================
//  doPost — WRITE
// ============================================================
function doPost(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return _apiErr("Missing POST request body / empty payload", 400);
  }
  var body = {};
  try { 
    body = JSON.parse(e.postData.contents); 
  } catch(ex) { 
    return _apiErr("Malformed or invalid JSON body: " + ex.message, 400); 
  }
  if (!_apiAuth({postData:{contents:JSON.stringify(body)}})) return _apiErr("Unauthorized",401);

  var action = body.action;
  var ss = _getSs();
  if (!ss) return _apiErr("Spreadsheet not found or inaccessible. Please verify SHEET_ID.", 500);

  try {
    switch(action) {

      // ── Save Invoice — calls your existing saveInvoice() ───
      case "save_invoice": {
        var d = body.data;
        if (!d||!d.custId||!d.items||!d.items.length) return _apiErr("Missing custId or items");
        d.createdBy = body.createdBy || d.createdBy || "api";
        
        // Ensure customer name is populated inside d
        var custName = d.custName || d.customerName || d.customer || "";
        if (!custName) {
          try {
            var custWs = ss.getSheetByName(CFG.CUST);
            if (custWs) {
              var cData = custWs.getDataRange().getValues();
              for (var i=3; i<cData.length; i++) {
                if (cData[i][0] && cData[i][0].toString().trim() === d.custId) {
                  custName = cData[i][1] || "";
                  break;
                }
              }
            }
          } catch(e) {}
        }
        d.custName = custName;
        d.customerName = custName;
        d.customer = custName;

        // Call your existing saveInvoice function which handles sheet insertion and native PDF generation
        var result = saveInvoice(d);
        var invId = d.invId || (typeof nextINV !== "undefined" ? nextINV() : "");
        
        // Retrieve the PDF generated by saveInvoice(d) from Drive
        Utilities.sleep(2000); // Give Drive 2 seconds to complete insertion and indexing
        var pdfUrl = "";
        if (invId) {
          pdfUrl = _findPdfInDrive(invId);
        }
        
        // Fallback: ONLY generate if saveInvoice failed to create one (to guarantee at least 1 copy)
        if (!pdfUrl) {
          try {
            var total = d.items.reduce(function(s,i){return s+(i.qty*i.rate);},0)*(1+(d.tax||0)/100);
            pdfUrl = _customGeneratePDF(d, total);
          } catch(pdfErr) { pdfUrl = ""; }
        } else {
          // If already found, make sure it is named clean and correctly
          _renamePdfFile(invId, custName);
          pdfUrl = _findPdfInDrive(invId) || pdfUrl;
        }
        
        return _apiOk({ message:result, id:invId, pdfUrl:pdfUrl });
      }

      // ── Save Expense ───────────────────────────────────────
      case "save_expense": {
        var d = body.data;
        if (!d||!d.amount) return _apiErr("Missing amount");
        d.paidBy = body.user || d.by || "api";
        var result = saveExpense({
          expId: _getNextId(ss.getSheetByName(CFG.EXP), "EXP"),
          date:  d.date || _today(),
          cat:   d.category || "Misc",
          desc:  d.notes || d.desc || "",
          amount:parseFloat(d.amount),
          paidBy:d.paidBy,
          notes: d.notes || ""
        });
        return _apiOk({ message:result });
      }

      // ── Save Payment ───────────────────────────────────────
      case "save_payment": {
        var d = body.data;
        if (!d||!d.amount) return _apiErr("Missing amount");
        var result = savePayment({
          payId:  _getNextId(ss.getSheetByName(CFG.PAY), "PAY"),
          date:   d.date || _today(),
          type:   d.type || "Received",
          partyId:d.custId || d.vendorId || d.partyId || "",
          refId:  d.invId || d.purId || d.refId || "",
          amount: parseFloat(d.amount),
          notes:  (d.method||"Cash") + (d.notes?" — "+d.notes:"")
        });
        // Update invoice status if linked
        if (d.invId && d.type==="Received") {
          _updateInvoiceStatus(ss, d.invId, parseFloat(d.amount));
        }
        return _apiOk({ message:result });
      }

      // ── Save Purchase ──────────────────────────────────────
      case "save_purchase": {
        var d = body.data;
        if (!d||!d.vendorId||!d.total) return _apiErr("Missing vendorId or total");
        // Minimal purchase (no items) or with items
        var items = d.items || [{pid:"",qty:1,cost:parseFloat(d.total),total:parseFloat(d.total)}];
        var result = savePurchase({
          purId: _getNextId(ss.getSheetByName(CFG.PUR_H), "PUR"),
          date:  d.date || _today(),
          venId: d.vendorId,
          notes: d.notes || "",
          items: items
        });
        return _apiOk({ message:result });
      }

      // ── Add Customer ───────────────────────────────────────
      case "add_customer": {
        var d = body.data;
        if (!d||!d.name) return _apiErr("Missing name");
        var ws   = ss.getSheetByName(CFG.CUST);
        var newId = _getNextCustomerId(ss);
        var row  = _apiGetLastDataRow(ws,1)+1; if(row<4)row=4;
        ws.getRange(row,1).setValue(newId);
        ws.getRange(row,2).setValue(d.name);
        ws.getRange(row,3).setValue(d.city||"ISB");
        ws.getRange(row,4).setValue(d.area||"");
        ws.getRange(row,5).setValue(d.contact||"");
        ws.getRange(row,6).setValue(d.phone||"");
        ws.getRange(row,7).setValue(parseFloat(d.openBal)||0);
        ws.getRange(row,8).setValue(d.notes||"");
        // Ensure AR row
        _ensureCustomerInAR(ss, newId);
        return _apiOk({ id:newId, message:"Customer "+newId+" added: "+d.name });
      }

      // ── Mark Invoice Paid ──────────────────────────────────
      case "mark_paid": {
        var invId = body.invId;
        if (!invId) return _apiErr("Missing invId");
        var ws    = ss.getSheetByName(CFG.INV_H);
        var data  = ws.getDataRange().getValues();
        var found = false;
        for (var i=3; i<data.length; i++) {
          if (data[i][0]&&data[i][0].toString().trim().toUpperCase()===invId.toUpperCase()) {
            ws.getRange(i+1,6).setValue("Paid");
            found = true; break;
          }
        }
        if (!found) return _apiErr(invId + " not found");
        return _apiOk({ message:invId+" marked as Paid" });
      }

      // ── Generate / Re-generate PDF ─────────────────────────
      case "generate_pdf": {
        var invId = body.invId;
        if (!invId) return _apiErr("Missing invId");
        var pdfUrl = _generatePdfForInvoice(ss, invId);
        if (!pdfUrl) return _apiErr("Failed to generate PDF for "+invId);
        return _apiOk({ url:pdfUrl, message:"PDF ready" });
      }

      // ── Submit rider order (from Rider App) ───────────────
      case "rider_order": {
        var d = body.data;
        if (!d||!d.custId||!d.items||!d.items.length) return _apiErr("Missing custId or items");
        d.createdBy = body.riderId || "rider";
        d.payTerms  = d.payTerms || "COD";
        d.notes     = "[Rider App] " + (d.notes||"");
        var result  = saveInvoice(d);
        var invId   = d.invId || "";
        var pdfUrl  = "";
        try {
          var total = d.items.reduce(function(s,i){return s+(i.qty*i.rate);},0);
          pdfUrl = _customGeneratePDF(d, total);
        } catch(ex) {}
        return _apiOk({ message:result, id:invId, pdfUrl:pdfUrl });
      }

      // ── Void Invoice ───────────────────────────────────────
      case "void_invoice": {
        var invId = body.invId;
        if (!invId) return _apiErr("Missing invId");
        var result = voidInvoice(invId);
        return _apiOk({ message:result });
      }

      // ── Delete Invoice ─────────────────────────────────────
      case "delete_invoice": {
        var invId = body.invId;
        if (!invId) return _apiErr("Missing invId");
        var result = deleteInvoice(invId);
        return _apiOk({ message:result });
      }

      default: return _apiErr("Unknown action: " + action);
    }
  } catch(err) {
    return _apiErr("Server error: " + err.message, 500);
  }
}

// ============================================================
//  READ HELPERS
// ============================================================

// Helper to safely retrieve the Spreadsheet object
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
  if (val instanceof Date) return Utilities.formatDate(val, API_CFG.TZ, "yyyy-MM-dd");
  return val.toString().substring(0,10);
}

function _apiGetLastDataRow(ws, col) {
  col = col||1;
  var total = ws.getLastRow();
  if (total<4) return 3;
  var vals = ws.getRange(4,col,total-3,1).getValues();
  for (var i=vals.length-1;i>=0;i--) {
    var v=vals[i][0];
    if (v!==null&&v!==undefined&&v!==""&&v!==0&&v.toString().trim()!=="") return i+4;
  }
  return 3;
}

function _getNextId(ws, prefix) {
  if (!ws) return prefix+"-0001";
  var lastRow = ws.getLastRow();
  if (lastRow<4) return prefix+"-0001";
  var data = ws.getRange(4,1,lastRow-3,1).getValues();
  var max=0;
  data.forEach(function(r){
    var v=r[0]?r[0].toString().trim():"";
    if (v.toUpperCase().startsWith(prefix.toUpperCase()+"-")) {
      var n=parseInt(v.split("-").pop())||0;
      if(n>max)max=n;
    }
  });
  return prefix+"-"+String(max+1).padStart(4,"0");
}

function _getNextCustomerId(ss) {
  ss = _getSs(ss);
  if (!ss) return "C-001";
  var ws=ss.getSheetByName(CFG.CUST);
  if (!ws||ws.getLastRow()<4) return "C-001";
  var data=ws.getRange(4,1,ws.getLastRow()-3,1).getValues();
  var max=0;
  data.forEach(function(r){
    var v=r[0]?r[0].toString().trim():"";
    if (v.match(/^C-\d+$/)) { var n=parseInt(v.replace("C-"))||0; if(n>max)max=n; }
  });
  return "C-"+String(max+1).padStart(3,"0");
}

function _readCustomers(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  var ws=ss.getSheetByName(CFG.CUST);
  if (!ws||ws.getLastRow()<4) return [];
  var data=ws.getRange(4,1,ws.getLastRow()-3,8).getValues();
  var out=[];
  data.forEach(function(r){
    if (!r[0]||!r[0].toString().trim()) return;
    out.push({id:r[0].toString().trim(),name:r[1]?r[1].toString().trim():"",city:r[2]?r[2].toString().trim():"",area:r[3]?r[3].toString().trim():"",contact:r[4]?r[4].toString().trim():"",phone:r[5]?r[5].toString().trim():"",openBal:parseFloat(r[6])||0,notes:r[7]?r[7].toString().trim():""});
  });
  return out;
}

function _readVendors(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  var ws=ss.getSheetByName(CFG.VEN);
  if (!ws||ws.getLastRow()<4) return [];
  var data=ws.getRange(4,1,ws.getLastRow()-3,8).getValues();
  var out=[];
  data.forEach(function(r){
    if (!r[0]||!r[0].toString().trim()) return;
    out.push({id:r[0].toString().trim(),name:r[1]?r[1].toString().trim():"",category:r[2]?r[2].toString().trim():"",contact:r[3]?r[3].toString().trim():"",phone:r[4]?r[4].toString().trim():"",openBal:parseFloat(r[5])||0,notes:r[6]?r[6].toString().trim():""});
  });
  return out;
}

function _readProducts(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  var ws=ss.getSheetByName(CFG.PROD);
  if (!ws||ws.getLastRow()<4) return [];
  var numCols=Math.min(ws.getLastColumn(),9);
  var data=ws.getRange(4,1,ws.getLastRow()-3,numCols).getValues();
  var out=[];
  data.forEach(function(r){
    if (!r[0]||!r[1]) return;
    out.push({id:r[0].toString().trim(),name:r[1].toString().trim(),category:r[2]?r[2].toString().trim():"",vendorId:r[3]?r[3].toString().trim():"",cost:parseFloat(r[5])||0,price:parseFloat(r[6])||0,minStock:parseFloat(r[8])||0});
  });
  return out;
}

function _readInvoices(ss, limit) {
  ss = _getSs(ss);
  if (!ss) return [];
  var ws=ss.getSheetByName(CFG.INV_H);
  if (!ws||ws.getLastRow()<4) return [];
  var lastRow=ws.getLastRow();
  var startRow=Math.max(4,lastRow-(limit||300)+1);
  var numRows=lastRow-startRow+1;
  var data=ws.getRange(startRow,1,numRows,8).getValues();
  var out=[];
  data.forEach(function(r){
    if (!r[0]) return;
    out.push({id:r[0].toString().trim(),date:_fmtDate(r[1]),custId:r[2]?r[2].toString().trim():"",custName:r[3]?r[3].toString().trim():"",total:parseFloat(r[4])||0,status:r[5]?r[5].toString().trim():"Unpaid",payTerms:r[6]?r[6].toString().trim():"COD",createdBy:r[7]?r[7].toString().trim():""});
  });
  out.reverse();
  return out;
}

function _readPurchases(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  var ws=ss.getSheetByName(CFG.PUR_H);
  if (!ws||ws.getLastRow()<4) return [];
  var data=ws.getRange(4,1,ws.getLastRow()-3,7).getValues();
  var out=[];
  data.forEach(function(r){
    if (!r[0]) return;
    out.push({id:r[0].toString().trim(),date:_fmtDate(r[1]),vendorId:r[2]?r[2].toString().trim():"",vendor:r[3]?r[3].toString().trim():"",total:parseFloat(r[4])||0,paid:parseFloat(r[5])||0,notes:r[6]?r[6].toString().trim():""});
  });
  out.reverse();
  return out;
}

function _readPayments(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  var ws=ss.getSheetByName(CFG.PAY);
  if (!ws||ws.getLastRow()<4) return [];
  var data=ws.getRange(4,1,ws.getLastRow()-3,8).getValues();
  var out=[];
  data.forEach(function(r){
    if (!r[0]) return;
    out.push({id:r[0].toString().trim(),date:_fmtDate(r[1]),type:r[2]?r[2].toString().trim():"",partyId:r[3]?r[3].toString().trim():"",partyName:r[4]?r[4].toString().trim():"",refId:r[5]?r[5].toString().trim():"",amount:parseFloat(r[6])||0,notes:r[7]?r[7].toString().trim():""});
  });
  out.reverse();
  return out;
}

function _readExpenses(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  var ws=ss.getSheetByName(CFG.EXP);
  if (!ws||ws.getLastRow()<4) return [];
  var data=ws.getRange(4,1,ws.getLastRow()-3,7).getValues();
  var out=[];
  data.forEach(function(r){
    if (!r[0]) return;
    out.push({id:r[0].toString().trim(),date:_fmtDate(r[1]),category:r[2]?r[2].toString().trim():"",notes:r[3]?r[3].toString().trim():"",amount:parseFloat(r[4])||0,by:r[5]?r[5].toString().trim():""});
  });
  out.reverse();
  return out;
}

function _readAR(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  var ws=ss.getSheetByName(CFG.AR);
  if (!ws||ws.getLastRow()<4) return [];
  var data=ws.getRange(4,1,ws.getLastRow()-3,7).getValues();
  var out=[];
  data.forEach(function(r){
    if (!r[0]) return;
    out.push({custId:r[0].toString().trim(),custName:r[1]?r[1].toString().trim():"",city:r[2]?r[2].toString().trim():"",totalBilled:parseFloat(r[3])||0,totalPaid:parseFloat(r[4])||0,balance:parseFloat(r[5])||0,status:r[6]?r[6].toString().trim():""});
  });
  return out;
}

function _readAP(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  var ws=ss.getSheetByName(CFG.AP);
  if (!ws||ws.getLastRow()<4) return [];
  var data=ws.getRange(4,1,ws.getLastRow()-3,6).getValues();
  var out=[];
  data.forEach(function(r){
    if (!r[0]) return;
    out.push({vendorId:r[0].toString().trim(),vendorName:r[1]?r[1].toString().trim():"",category:r[2]?r[2].toString().trim():"",totalOrdered:parseFloat(r[3])||0,totalPaid:parseFloat(r[4])||0,balance:parseFloat(r[5])||0});
  });
  return out;
}

function _readInventory(ss) {
  ss = _getSs(ss);
  if (!ss) return [];
  var ws=ss.getSheetByName(CFG.INV_L);
  if (!ws||ws.getLastRow()<4) return [];
  var data=ws.getRange(4,1,ws.getLastRow()-3,10).getValues();
  var out=[];
  data.forEach(function(r){
    if (!r[0]) return;
    out.push({pid:r[0].toString().trim(),pname:r[1]?r[1].toString().trim():"",category:r[2]?r[2].toString().trim():"",cost:parseFloat(r[3])||0,purchased:parseFloat(r[4])||0,sold:parseFloat(r[5])||0,returned:parseFloat(r[6])||0,prReturned:parseFloat(r[7])||0,stock:parseFloat(r[8])||0,minStock:parseFloat(r[9])||0});
  });
  return out;
}

function _readDashboard(ss) {
  ss = _getSs(ss);
  if (!ss) return { totalInvoiced:0, totalReceived:0, totalPurchases:0, totalExpenses:0, netProfit:0, outstandingAR:0 };
  // Try Control Panel first
  var sheets = ss.getSheets();
  var cp = null;
  for (var i=0;i<sheets.length;i++) {
    if (sheets[i].getName().indexOf("Control")!==-1||sheets[i].getName().indexOf("Panel")!==-1) { cp=sheets[i]; break; }
  }
  if (!cp) cp = sheets[0];
  // Fallback: compute from data
  try {
    var snap = cp.getRange("D18:D23").getValues();
    return { totalInvoiced:snap[0][0]||0, totalReceived:snap[1][0]||0, totalPurchases:snap[2][0]||0, totalExpenses:snap[3][0]||0, netProfit:snap[4][0]||0, outstandingAR:snap[5][0]||0 };
  } catch(e) {
    // Compute directly
    var invH=ss.getSheetByName(CFG.INV_H);
    var pay=ss.getSheetByName(CFG.PAY);
    var purH=ss.getSheetByName(CFG.PUR_H);
    var exp=ss.getSheetByName(CFG.EXP);
    var ti=0,tr=0,tp=0,te=0;
    if (invH&&invH.getLastRow()>3) invH.getRange(4,5,invH.getLastRow()-3,1).getValues().forEach(function(r){ti+=parseFloat(r[0])||0;});
    if (pay&&pay.getLastRow()>3) { var pd=pay.getRange(4,1,pay.getLastRow()-3,7).getValues(); pd.forEach(function(r){if(r[2]==="Received")tr+=parseFloat(r[6])||0;}); }
    if (purH&&purH.getLastRow()>3) purH.getRange(4,5,purH.getLastRow()-3,1).getValues().forEach(function(r){tp+=parseFloat(r[0])||0;});
    if (exp&&exp.getLastRow()>3) exp.getRange(4,5,exp.getLastRow()-3,1).getValues().forEach(function(r){te+=parseFloat(r[0])||0;});
    return { totalInvoiced:ti, totalReceived:tr, totalPurchases:tp, totalExpenses:te, netProfit:(ti-tp-te), outstandingAR:(ti-tr) };
  }
}

// ── Rider journey plan ───────────────────────────────────────
function _readRiderJourney(ss, riderId) {
  ss = _getSs(ss);
  if (!ss) return [];
  var customers = _readCustomers(ss);
  // Group by area/zone using _detectZone
  var zones = {};
  customers.forEach(function(c) {
    var sec = _detectZone ? _detectZone(c.area||"") : {zone:"Other",day:""};
    var z = sec.zone;
    if (!zones[z]) zones[z] = {zone:z, day:sec.day, stores:[]};
    zones[z].stores.push({id:c.id, name:c.name, area:c.area, phone:c.phone});
  });
  return Object.values(zones);
}

function _readRiderOrders(ss, riderId) {
  ss = _getSs(ss);
  if (!ss) return [];
  // Return today's pending invoices for rider tracking
  var invoices = _readInvoices(ss, 100);
  var today = _today();
  return invoices.filter(function(i) {
    return i.status==="Unpaid" || i.status==="Partial";
  }).slice(0, 50);
}

// ============================================================
//  PDF GENERATION + DRIVE SAVE
//  Reuses your existing _generatePDF logic but uses
//  the specific Drive folder ID you provided
// ============================================================
function _findPdfInDrive(invId) {
  try {
    var folder = DriveApp.getFolderById(API_CFG.DRIVE_FOLDER);
    var files = folder.getFilesByName(invId);
    if (files.hasNext()) return files.next().getUrl();
    // Search with partial name
    var allFiles = folder.getFiles();
    while (allFiles.hasNext()) {
      var f = allFiles.next();
      if (f.getName().indexOf(invId) !== -1) return f.getUrl();
    }
  } catch(e) {}
  return null;
}

function _generatePdfForInvoice(ss, invId) {
  ss = _getSs(ss);
  if (!ss) return null;
  var invH  = ss.getSheetByName(CFG.INV_H);
  var invI  = ss.getSheetByName(CFG.INV_I);
  var custWs= ss.getSheetByName(CFG.CUST);
  if (!invH||!invI) return null;

  // Find invoice header
  var hData = invH.getDataRange().getValues();
  var inv   = null;
  for (var i=3; i<hData.length; i++) {
    if (hData[i][0]&&hData[i][0].toString().trim().toUpperCase()===invId.toUpperCase()) { inv=hData[i]; break; }
  }
  if (!inv) return null;

  // Find items
  var iData = invI.getDataRange().getValues();
  var items = [];
  iData.forEach(function(r){
    if (r[0]&&r[0].toString().trim().toUpperCase()===invId.toUpperCase()&&r[1]) {
      items.push({pid:r[1].toString().trim(),pname:r[2]?r[2].toString().trim():"",qty:parseFloat(r[3])||1,rate:parseFloat(r[4])||0,total:parseFloat(r[5])||0});
    }
  });
  if (!items.length) return null;

  var custName = inv[3]||inv[2];
  if (!custName && custWs) {
    var cData = custWs.getDataRange().getValues();
    for (var i=3;i<cData.length;i++) {
      if (cData[i][0]&&cData[i][0].toString().trim()===inv[2]) { custName=cData[i][1]||inv[2]; break; }
    }
  }

  var d = { 
    invId: invId, 
    date: _fmtDate(inv[1]), 
    custId: inv[2]||"", 
    custName: custName,
    customerName: custName,
    customer: custName,
    payTerms: inv[6]||"COD", 
    notes: "Thank you for your business.", 
    tax: 0, 
    items: items 
  };
  var total = items.reduce(function(s,i){return s+i.total;},0);

  try {
    return _customGeneratePDF(d, total);
  } catch(e) {
    return null;
  }
}

function _updateInvoiceStatus(ss, invId, amtReceived) {
  ss = _getSs(ss);
  if (!ss) return;
  var ws = ss.getSheetByName(CFG.INV_H);
  if (!ws) return;
  var data = ws.getLastRow()<4 ? [] : ws.getRange(4,1,ws.getLastRow()-3,6).getValues();
  // Find total paid from payments
  var payWs = ss.getSheetByName(CFG.PAY);
  var totalPaid = amtReceived;
  if (payWs&&payWs.getLastRow()>3) {
    var pData = payWs.getRange(4,1,payWs.getLastRow()-3,7).getValues();
    pData.forEach(function(p){ if(p[5]&&p[5].toString().trim()===invId&&p[2]==="Received") totalPaid+=parseFloat(p[6])||0; });
  }
  for (var i=0;i<data.length;i++) {
    if (data[i][0]&&data[i][0].toString().trim().toUpperCase()===invId.toUpperCase()) {
      var total=parseFloat(data[i][4])||0;
      var status=totalPaid>=total?"Paid":totalPaid>0?"Partial":"Unpaid";
      ws.getRange(i+4,6).setValue(status);
      return;
    }
  }
}

// ── Delete Invoice ──
function deleteInvoice(invId) {
  if (!invId) return "Error: No Invoice ID provided";
  var ss = _getSs();
  if (!ss) return "Error: Spreadsheet not found or inaccessible";
  
  // 1. Delete from Invoice Headers
  var sheetH = ss.getSheetByName(CFG.INV_H);
  if (sheetH) {
    var dataH = sheetH.getDataRange().getValues();
    for (var i = dataH.length - 1; i >= 3; i--) {
      if (dataH[i][0] && dataH[i][0].toString().trim().toUpperCase() === invId.toUpperCase()) {
        sheetH.deleteRow(i + 1);
      }
    }
  }
  
  // 2. Delete from Invoice Items
  var sheetI = ss.getSheetByName(CFG.INV_I);
  if (sheetI) {
    var dataI = sheetI.getDataRange().getValues();
    for (var i = dataI.length - 1; i >= 3; i--) {
      if (dataI[i][0] && dataI[i][0].toString().trim().toUpperCase() === invId.toUpperCase()) {
        sheetI.deleteRow(i + 1);
      }
    }
  }

  // 3. Delete matching Payments recorded against this invoice
  var sheetPay = ss.getSheetByName(CFG.PAY);
  if (sheetPay) {
    var dataPay = sheetPay.getDataRange().getValues();
    for (var i = dataPay.length - 1; i >= 3; i--) {
      if (dataPay[i][5] && dataPay[i][5].toString().trim().toUpperCase() === invId.toUpperCase()) {
        sheetPay.deleteRow(i + 1);
      }
    }
  }

  return "Invoice " + invId + " and associated items/payments deleted successfully";
}

// ── Rename PDF File in Drive (Fast SearchFiles method) ──
function _renamePdfFile(invId, custName) {
  try {
    var folder = DriveApp.getFolderById(API_CFG.DRIVE_FOLDER);
    var files = folder.searchFiles("title contains '" + invId + "'");
    while (files.hasNext()) {
      var f = files.next();
      var name = f.getName();
      var cleanName = (custName ? custName.toString().trim() : "Customer") + " - " + invId + ".pdf";
      if (name !== cleanName) {
        f.setName(cleanName);
      }
    }
  } catch(e) {
    Logger.log("Rename failed: " + e.message);
  }
}

// ── Custom robust self-contained PDF generator ──
function _customGeneratePDF(d, total) {
  try {
    var payload = {
      from: "Assorted Produce Traders",
      to: d.custName || d.customerName || d.customer || "Customer",
      number: d.invId || "INV",
      date: d.date || _today(),
      payment_terms: d.payTerms || "COD",
      notes: d.notes || "Thank you for your business.",
      items: d.items.map(function(item) {
        return {
          name: item.pname || item.pid,
          quantity: parseFloat(item.qty) || 0,
          unit_cost: parseFloat(item.rate) || 0
        };
      }),
      tax: d.tax || 0,
      fields: {
        tax: "%"
      }
    };

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

    var response = UrlFetchApp.fetch("https://invoice-generator.com", options);
    if (response.getResponseCode() !== 200) {
      throw new Error("PDF generator failed: " + response.getContentText());
    }

    var fileName = (d.custName || "Customer").toString().trim() + " - " + (d.invId || "INV") + ".pdf";
    var blob = response.getBlob().setName(fileName);
    var folder = DriveApp.getFolderById(API_CFG.DRIVE_FOLDER);
    
    // Clean up any existing duplicate file with the exact name or containing invId first
    if (d.invId) {
      var oldFiles = folder.searchFiles("title contains '" + d.invId + "'");
      while (oldFiles.hasNext()) {
        try {
          oldFiles.next().setTrashed(true);
        } catch(ex) {}
      }
    }

    var file = folder.createFile(blob);
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return file.getUrl();
  } catch(e) {
    Logger.log("Custom PDF error: " + e.message);
    return "";
  }
}
