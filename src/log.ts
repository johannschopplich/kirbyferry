/* eslint-disable no-console */
import * as ansis from 'ansis'

export function success(message: string): void {
  console.log(`${ansis.green('✔')} ${message}`)
}

export function error(message: string): void {
  console.error(`${ansis.red('✖')} ${message}`)
}

export function info(message: string): void {
  console.log(`${ansis.cyan('●')} ${message}`)
}

export function warn(message: string): void {
  console.warn(`${ansis.yellow('⚠')} ${message}`)
}
