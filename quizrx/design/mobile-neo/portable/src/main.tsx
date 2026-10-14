import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Renderer} from './Renderer';
import type {Project} from '../shared/types';
import {initialDemoPageId} from '../shared/initial-demo-page';
import {createNavigationHistory, pushPageHistory, popPageHistory} from '../shared/navigation';
import project from './project.json';
import './runtime.css';
const data=project as unknown as Project;
function App(){
  const [page,setPage]=useState(()=>initialDemoPageId(data));
  const [history,setHistory]=useState<string[]>(()=>createNavigationHistory(initialDemoPageId(data)));
  const handleNavigate=(targetPageId:string)=>{
    if(!targetPageId||targetPageId===page)return;
    setHistory(prev=>pushPageHistory(prev,targetPageId));
    setPage(targetPageId);
  };
  const handleBack=()=>{
    const initialId=initialDemoPageId(data);
    const result=popPageHistory(history,initialId);
    setHistory(result.nextStack);
    if(result.targetPageId&&result.targetPageId!==page){
      setPage(result.targetPageId);
    }
  };
  const canBack=history.length>1||page!==initialDemoPageId(data);
  return <main style={{maxWidth:430,width:'100%',margin:'0 auto',minHeight:'100vh',display:'flex',flexDirection:'column',flex:1,backgroundColor:'#FFFBEB'}}><Renderer project={data} pageId={page} editing={false} onNavigate={handleNavigate} onBack={handleBack} canBack={canBack} assetBase="./assets/"/></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
