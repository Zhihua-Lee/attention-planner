import {beforeEach,describe,it,expect,vi} from 'vitest';
import {webStorage} from './storage-adapter-web';
vi.mock('./report-error',()=>({reportError:vi.fn()}));
beforeEach(()=>localStorage.clear());
describe('planner local storage generation',()=>{
    it('copies legacy data once, preserving an untouched backup',async()=>{
        const legacy=JSON.stringify({tasks:[],projects:[],settings:{language:'en'}});localStorage.setItem('mindwtr-data',legacy);
        const data=await webStorage.getData();expect(localStorage.getItem('mindwtr-data')).toBe(legacy);
        expect(JSON.parse(localStorage.getItem('attention-planner-data-v2')!)).toEqual(data);
        localStorage.setItem('mindwtr-data',JSON.stringify({...data,tasks:[{id:'old-client-write'}]}));
        expect((await webStorage.getData()).tasks).toEqual([]);
    });
    it('round-trips independent blocks and day commitments after a reload',async()=>{
        const data={tasks:[{id:'t',title:'Paper',status:'next' as const,contexts:[],tags:[],createdAt:'2026-09-17T12:00:00Z',updatedAt:'2026-09-17T12:00:00Z',planner:{version:1 as const,blocks:[],days:[]}}],projects:[],areas:[],sections:[],settings:{}};
        await webStorage.saveData(data);expect(await webStorage.getData()).toEqual(data);
    });
    it('does not silently restore stale legacy data when current data is malformed',async()=>{
        localStorage.setItem('mindwtr-data',JSON.stringify({tasks:[],projects:[]}));localStorage.setItem('attention-planner-data-v2','broken');
        await expect(webStorage.getData()).rejects.toThrow('corrupted');expect(localStorage.getItem('attention-planner-data-v2')).toBe('broken');
    });
});
