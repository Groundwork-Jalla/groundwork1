export function dateFilterValue(date:Date):string {
 return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
/** Date inputs use the admin's calendar, including the complete end date. */
export function communicationDateRange(from:string,through:string) {
 const parse=(value:string)=>{
  const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);if(!match)throw new Error('invalid_tracking_dates');
  const result=new Date(Number(match[1]),Number(match[2])-1,Number(match[3]));
  if(dateFilterValue(result)!==value)throw new Error('invalid_tracking_dates');return result;
 };
 const first=parse(from),last=parse(through);if(first>last)throw new Error('invalid_tracking_dates');
 last.setDate(last.getDate()+1);return {from:first.toISOString(),until:last.toISOString()};
}
