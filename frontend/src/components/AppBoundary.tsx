import {Component} from 'react';
import type {ReactNode} from 'react';
export class AppBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true}}
 render(){return this.state.failed?<main className="recovery-screen"><span className="eyebrow">SENTINEL · RECOVERY</span><h1>The console couldn’t finish rendering.</h1><p>Your persisted observations remain on the server. Reload to reconnect.</p><button className="button primary" onClick={()=>location.reload()}>Reload console</button></main>:this.props.children}
}
