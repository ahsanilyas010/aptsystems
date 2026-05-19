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

// ── CORS + Response helpers ──────────────────────────────────
function _apiCors(out) {
  return out
    .setHeader("Access-Control-Allow-Origin", "*")
    .setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
    .setHeader("Access-Control-Allow-Headers", "Content-Type,X-API-Key");
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
  return _apiCors(ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT));
}

// ============================================================
//  doGet — READ
// ============================================================
function doGet(e) {
  if (!_apiAuth(e)) return _apiErr("Unauthorized", 401);
  var action = (e.parameter && e.parameter.action) || "dashboard";
  var ss = SpreadsheetApp.openById(API_CFG.SHEET_ID);

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
  var body = {};
  try { body = JSON.parse(e.postData.contents); } catch(ex) { return _apiErr("Invalid JSON body"); }
  if (!_apiAuth({postData:{contents:JSON.stringify(body)}})) return _apiErr("Unauthorized",401);

  var action = body.action;
  var ss = SpreadsheetApp.openById(API_CFG.SHEET_ID);

  try {
    switch(action) {

      // ── Save Invoice — calls your existing saveInvoice() ───
      case "save_invoice": {
        var d = body.data;
        if (!d||!d.custId||!d.items||!d.items.length) return _apiErr("Missing custId or items");
        d.createdBy = body.createdBy || d.createdBy || "api";
        // Call your existing saveInvoice function
        var result = saveInvoice(d);
        // Generate PDF immediately and return URL
        var invId = d.invId || nextINV();
        var pdfUrl = "";
        try {
          var total = d.items.reduce(function(s,i){return s+(i.qty*i.rate);},0)*(1+(d.tax||0)/100);
          pdfUrl = _generatePDF(d, total);
        } catch(pdfErr) { pdfUrl = ""; }
        return _apiOk({ message:result, id:d.invId, pdfUrl:pdfUrl });
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
        var invId   = d.invId;
        var pdfUrl  = "";
        try {
          var total = d.items.reduce(function(s,i){return s+(i.qty*i.rate);},0);
          pdfUrl = _generatePDF(d, total);
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

  var d = { invId:invId, date:_fmtDate(inv[1]), custId:inv[2]||"", payTerms:inv[6]||"COD", notes:"Thank you for your business.", tax:0, items:items };
  var total = items.reduce(function(s,i){return s+i.total;},0);

  try {
    return _generatePDF(d, total);
  } catch(e) {
    return null;
  }
}

function _updateInvoiceStatus(ss, invId, amtReceived) {
  var ws = ss.getSheetByName(CFG.INV_H);
  if (!ws) return;
  var data = ws.getDataRange().getValues();
  // Find total paid from payments
  var payWs = ss.getSheetByName(CFG.PAY);
  var totalPaid = amtReceived;
  if (payWs&&payWs.getLastRow()>3) {
    var pData = payWs.getRange(4,1,payWs.getLastRow()-3,7).getValues();
    pData.forEach(function(p){ if(p[5]&&p[5].toString().trim()===invId&&p[2]==="Received") totalPaid+=parseFloat(p[6])||0; });
  }
  for (var i=3;i<data.length;i++) {
    if (data[i][0]&&data[i][0].toString().trim().toUpperCase()===invId.toUpperCase()) {
      var total=parseFloat(data[i][4])||0;
      var status=totalPaid>=total?"Paid":totalPaid>0?"Partial":"Unpaid";
      ws.getRange(i+1,6).setValue(status);
      return;
    }
  }
}

// ── Delete Invoice ──
function deleteInvoice(invId) {
  if (!invId) return "Error: No Invoice ID provided";
  var ss = SpreadsheetApp.openById(API_CFG.SHEET_ID);
  
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
