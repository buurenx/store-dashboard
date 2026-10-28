const dateValue = value => typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
const numberValue=(value,label,{negative=false,nullable=false}={})=>{
  if(value===null&&nullable)return null;
  if(value===null||value===undefined||String(value).trim()==='')throw Error(`Заполните ${label}.`);
  const n=Number(String(value).replace(',','.'));
  if(!Number.isFinite(n)||Math.abs(n)>1e12||(!negative&&n<0))throw Error(`Некорректное число ${label}.`);
  return n;
};
export function validateDataset(input){
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Ожидается объект с массивами sales, stock и purchases.');
  if(input.version!==undefined&&input.version!==1)throw Error('Поддерживается только version: 1.');
  const output={version:1,sales:[],stock:[],purchases:[]}, stockKeys=new Set();
  let count=0;
  for(const type of ['sales','stock','purchases']){
    if(input[type]!==undefined&&!Array.isArray(input[type]))throw Error(`${type}: ожидается массив.`);
    const rows=input[type]||[];
    if(rows.length>100000)throw Error(`${type}: максимум 100 000 строк.`);
    rows.forEach((r,index)=>{
      const loc=`${type}, строка ${index+1}`;
      if(!r||typeof r!=='object')throw Error(`${loc}: некорректная запись.`);
      const out={};
      for(const field of ['date','store','sku','name','category',...(type==='sales'?['receipt']:type==='purchases'?['supplier','status']:[])]){
        if(typeof r[field]!=='string'||!r[field].trim())throw Error(`${loc}: заполните ${field}.`);
        out[field]=r[field].trim();if(out[field].length>500)throw Error(`${loc}: ${field} длиннее 500 символов.`);
      }
      if(!dateValue(out.date))throw Error(`${loc}: date должен быть реальной датой YYYY-MM-DD.`);
      out.quantity=numberValue(r.quantity,`${loc}: quantity`,{negative:true});
      out.unitCost=numberValue(r.unitCost,`${loc}: unitCost`,{nullable:r.costKnown===false});
      out.costKnown=r.costKnown!==false&&out.unitCost!==null;
      if(!out.costKnown)out.unitCost=null;
      if(type==='sales'){
        out.unitPrice=numberValue(r.unitPrice,`${loc}: unitPrice`);
        out.receiptKnown=r.receiptKnown!==false;
        if(r.revenueAmount!==undefined)out.revenueAmount=numberValue(r.revenueAmount,`${loc}: revenueAmount`,{negative:true});
      }
      if(type==='purchases'){
        if(!['ordered','received','cancelled'].includes(out.status))throw Error(`${loc}: status — ordered, received или cancelled.`);
        if(r.amount!==undefined)out.amount=numberValue(r.amount,`${loc}: amount`,{negative:true});
        if(out.status==='ordered'&&out.quantity<0)throw Error(`${loc}: отрицательный открытый заказ.`);
      }
      if(type==='stock'){
        out.minStock=numberValue(r.minStock,`${loc}: minStock`);
        out.minStockKnown=r.minStockKnown!==false;
        out.expiry=r.expiry||null;
        if(out.expiry&&!dateValue(out.expiry))throw Error(`${loc}: некорректная expiry.`);
        out.expiryKnown=r.expiryKnown!==false&&out.expiry!==null;
        out.egaisQuantity=r.egaisQuantity===null||r.egaisQuantity===undefined||r.egaisQuantity===''?null:numberValue(r.egaisQuantity,`${loc}: egaisQuantity`,{negative:true});
        const key=`${out.store}\0${out.sku}`;
        if(stockKeys.has(key))throw Error(`${loc}: повтор магазина и SKU. Объедините партии в один остаток.`);
        stockKeys.add(key);
      }
      output[type].push(out);count++;
    });
  }
  if(!count)throw Error('Файл не содержит данных.');
  if(new Set(output.stock.map(r=>r.date)).size>1)throw Error('stock должен содержать единый снимок остатков на одну дату.');
  if(input.receipts!==undefined){
    if(!Array.isArray(input.receipts)||input.receipts.length>300000)throw Error('receipts: ожидается массив до 300 000 строк.');
    output.receipts=input.receipts.map((r,i)=>{
      const out={};for(const field of ['date','store','sku','name','category','receipt']){
        if(typeof r[field]!=='string'||!r[field].trim()||r[field].length>500)throw Error(`receipts, строка ${i+1}: некорректный ${field}.`);
        out[field]=r[field].trim();
      }
      if(!dateValue(out.date))throw Error(`receipts, строка ${i+1}: некорректная дата.`);
      if(r.revenueAmount!==undefined)out.revenueAmount=numberValue(r.revenueAmount,`receipts, строка ${i+1}: revenueAmount`,{negative:true});
      return out;
    });
  }
  if(input.source&&typeof input.source==='object'){
    const source={};
    for(const field of ['configuration','exportedAt'])if(typeof input.source[field]==='string')source[field]=input.source[field].slice(0,500);
    for(const field of ['from','to'])if(dateValue(input.source[field]))source[field]=input.source[field];
    source.notes=Array.isArray(input.source.notes)?input.source.notes.slice(0,30).filter(n=>typeof n==='string').map(n=>n.slice(0,1500)):[];
    if(input.source.controlRevenue!==undefined)source.controlRevenue=numberValue(input.source.controlRevenue,'source.controlRevenue',{negative:true});
    output.source=source;
    if(source.from&&source.to&&source.from>source.to)throw Error('source.from позже source.to.');
  }
  if(output.source?.controlRevenue!==undefined){
    const actual=output.sales.reduce((a,r)=>a+(r.revenueAmount??r.quantity*r.unitPrice),0);
    if(Math.abs(actual-output.source.controlRevenue)>.02)throw Error('Контрольная выручка не совпадает с суммой строк. Выгрузка повреждена.');
  }
  return output;
}
