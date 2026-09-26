import { useEffect, useState } from 'react';
import type { Task } from '@mindwtr/core';
import { PlainCaptureSheet } from './PlainCaptureSheet';
export const QUICK_CAPTURE_EVENT = 'attention-planner:plain-capture';
export const LEGACY_CAPTURE_EVENT = 'mindwtr:quick-add';
export type CaptureRequest = { initialProps?:Partial<Task>;initialValue?:string;captureMode?:'text'|'audio';advanced?:boolean;expandContent?:boolean };
/** Text has one owner; legacy audio/import are explicitly selected, never stacked. */
export function PwaCaptureHost(){
    const [open,setOpen]=useState(false),[request,setRequest]=useState<CaptureRequest>({});
    useEffect(()=>{
        const receive=(event:Event)=>{
            const detail=(event as CustomEvent<CaptureRequest>).detail??{};
            if(detail.advanced||detail.captureMode==='audio')return;
            if(document.querySelector('[role="dialog"]:not([data-testid="plain-capture-sheet"])'))return;
            setRequest(detail);setOpen(true);
        };
        window.addEventListener(QUICK_CAPTURE_EVENT,receive);window.addEventListener(LEGACY_CAPTURE_EVENT,receive);
        return ()=>{window.removeEventListener(QUICK_CAPTURE_EVENT,receive);window.removeEventListener(LEGACY_CAPTURE_EVENT,receive);};
    },[]);
    return <PlainCaptureSheet isOpen={open} initialRequest={request} onClose={()=>setOpen(false)} onAdvanced={()=>{
        setOpen(false);window.dispatchEvent(new CustomEvent(LEGACY_CAPTURE_EVENT,{detail:{advanced:true,captureMode:'text'}}));
    }}/>;
}
