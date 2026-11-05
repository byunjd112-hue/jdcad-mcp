const SAMPLES = {
 bracket: {
  title: "브라켓 플레이트", drawingNo: "JD-M-001", material: "SS275", thickness: 10, author: "JDCAD", scale: "auto", sheet: "auto",
  notes: ["일반 공차: KS B ISO 2768-m", "지시 없는 모서리 C0.5 모따기", "표면처리: 전기 아연 도금"],
  tables: [{ title: "부품표", columns: [{name:"품번",w:1},{name:"품명",w:3},{name:"재질",w:2},{name:"수량",w:1},{name:"비고",w:2}], rows: [["1","브라켓 플레이트","SS275","1","t10"]] }],
  entities: [
   {type:"view", x:100, y:150, label:"정면도"},
   {type:"rect", x:0, y:0, w:200, h:120, r:10},
   {type:"circle", cx:25, cy:25, r:5.5},{type:"circle", cx:175, cy:25, r:5.5},{type:"circle", cx:25, cy:95, r:5.5},{type:"circle", cx:175, cy:95, r:5.5},
   {type:"centermark", cx:25, cy:25, r:5.5},{type:"centermark", cx:175, cy:25, r:5.5},{type:"centermark", cx:25, cy:95, r:5.5},{type:"centermark", cx:175, cy:95, r:5.5},
   {type:"circle", cx:100, cy:60, r:15},{type:"centermark", cx:100, cy:60, r:15},
   {type:"section", p1:[100,-12], p2:[100,132], label:"A", dir:"right"},
   {type:"dim", kind:"h", p1:[0,0], p2:[200,0], offset:-16},
   {type:"dim", kind:"h", p1:[0,25], p2:[25,25], offset:-33},
   {type:"dim", kind:"h", p1:[25,95], p2:[175,95], offset:14},
   {type:"dim", kind:"v", p1:[0,0], p2:[0,120], offset:-16},
   {type:"dim", kind:"v", p1:[0,0], p2:[25,25], offset:-8},
   {type:"dim", kind:"diameter", cx:25, cy:95, r:5.5, angle:135, text:"4-Ø11 관통"},
   {type:"dim", kind:"diameter", cx:100, cy:60, r:15, angle:35, suffix:" H8"},
   {type:"dim", kind:"radius", cx:190, cy:110, r:10, angle:45, text:"4-R10"},
   {type:"view", x:265, y:150, label:"단면 A-A"},
   {type:"rect", x:260, y:0, w:10, h:120},
   {type:"line", p1:[260,45], p2:[270,45]},{type:"line", p1:[260,75], p2:[270,75]},
   {type:"line", p1:[254,60], p2:[276,60], layer:"CENTER"},
   {type:"hatch", loops:[[[260,0],[270,0],[270,45],[260,45]]]},
   {type:"hatch", loops:[[[260,75],[270,75],[270,120],[260,120]]]},
   {type:"dim", kind:"h", p1:[260,0], p2:[270,0], offset:-16},
   {type:"leader", tx:270, ty:110, x:285, y:125, text:"t10"}
  ]
 },
 panel: {
  title: "동력반 MCC-1 단선결선도", drawingNo: "JD-E-001", material: "-", author: "JDCAD", scale: "auto", sheet: "auto",
  notes: ["심볼: KS C IEC 60617", "차단기 정격은 부하 계산서에 따름"],
  tables: [{ title: "부하 리스트", columns: [{name:"회로",w:1},{name:"부하명",w:3},{name:"용량",w:2},{name:"차단기",w:3}], rows: [["1","급수 펌프","7.5kW","MCCB 3P 30AF/20AT"],["2","배기팬","3.7kW","MCCB 3P 30AF/15AT"],["3","조명반 L-1","10kVA","MCCB 3P 50AF/30AT"]] }],
  entities: [
   {type:"text", x:100, y:212, text:"3Φ4W 380/220V 60Hz", align:"center", height:3.5},
   {type:"line", p1:[100,205], p2:[100,192], layer:"WIRE"},
   {type:"symbol", name:"meter", x:100, y:180, text:"kWh", label:"전력량계"},
   {type:"symbol", name:"breaker", x:100, y:166, label:"MAIN MCCB\n4P 100AF/75AT"},
   {type:"line", p1:[100,178], p2:[100,180], layer:"WIRE"},
   {type:"line", p1:[100,192], p2:[100,192], layer:"WIRE"},
   {type:"line", p1:[100,166], p2:[100,160], layer:"WIRE"},
   {type:"line", p1:[30,160], p2:[170,160], layer:"BUS"},
   {type:"text", x:172, y:161, text:"BUS 380V", height:3},
   {type:"line", p1:[50,160], p2:[50,150], layer:"WIRE"},{type:"symbol", name:"breaker", x:50, y:138, angle:0, label:"MCCB\n30AF/20AT"},{type:"line", p1:[50,138], p2:[50,124], layer:"WIRE"},{type:"symbol", name:"motor", x:50, y:112, label:"M1 급수 펌프\n7.5kW"},
   {type:"line", p1:[100,160], p2:[100,150], layer:"WIRE"},{type:"symbol", name:"breaker", x:100, y:138, label:"MCCB\n30AF/15AT"},{type:"line", p1:[100,138], p2:[100,124], layer:"WIRE"},{type:"symbol", name:"motor", x:100, y:112, label:"M2 배기팬\n3.7kW"},
   {type:"line", p1:[150,160], p2:[150,150], layer:"WIRE"},{type:"symbol", name:"breaker", x:150, y:138, label:"MCCB\n50AF/30AT"},{type:"line", p1:[150,138], p2:[150,124], layer:"WIRE"},{type:"symbol", name:"lamp", x:150, y:112, label:"조명반 L-1\n10kVA"},
   {type:"line", p1:[100,192], p2:[100,192], layer:"WIRE"},
   {type:"symbol", name:"ground", x:30, y:130, label:"E3 접지"},{type:"line", p1:[30,160], p2:[30,142], layer:"WIRE"}
  ]
 }
};
if (typeof module !== 'undefined') module.exports = SAMPLES;
