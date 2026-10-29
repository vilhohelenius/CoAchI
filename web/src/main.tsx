import { render } from 'preact'
import { App } from './app'
import { applyTheme } from './nav'
import './style.css'

applyTheme()

render(<App />, document.getElementById('app')!)
