import {validateData} from './data.js';

export async function loadPublishedData(){
  const response=await fetch(new URL('./snapshot.json',import.meta.url),{cache:'no-store'});
  if(!response.ok)throw Error(`Выгрузка 1С недоступна: HTTP ${response.status}.`);
  return validateData(await response.json());
}
