// BisaPointer v1 — iPad como trackpad do Mac (protótipo 2026-07-21).
// Lê eventos JSON (1 por linha) de um FIFO e injeta via CGEvent.
//   uso: bisapointer <fifo>
// Protocolo:
//   {"t":"m","dx":N,"dy":N}            mover (relativo; drag se botão preso)
//   {"t":"a","x":0..1,"y":0..1}        mover ABSOLUTO (modo Pencil/Wacom)
//   {"t":"c","b":"l|r","k":"click|down|up"}  clique / segurar / soltar
//   {"t":"s","dx":N,"dy":N}            scroll em pixels
// Na partida grava /tmp/bisa-pointer.info {"w","h"} da tela principal — o
// cliente usa p/ desenhar a área de mapeamento com o aspecto certo.
// TCC: exige Acessibilidade (prompt no 1º uso; conceder em Ajustes → Privacidade
// → Acessibilidade → BisaPointer). Empacotado como .app + open -na, padrão
// BisaEar — spawn direto sob launchd não gera prompt.
// Build (ver server.js /pointer): swiftc -O → BisaPointer.app + codesign -s -
import Foundation
import CoreGraphics
import ApplicationServices

func plog(_ s: String) {
  let line = "\(ISO8601DateFormatter().string(from: Date())) \(s)\n"
  if !FileManager.default.fileExists(atPath: "/tmp/bisa-pointer.log") {
    FileManager.default.createFile(atPath: "/tmp/bisa-pointer.log", contents: nil)
  }
  if let d = line.data(using: .utf8), let h = FileHandle(forWritingAtPath: "/tmp/bisa-pointer.log") {
    h.seekToEndOfFile(); h.write(d); h.closeFile()
  }
}

guard CommandLine.arguments.count > 1 else {
  FileHandle.standardError.write("uso: bisapointer <fifo>\n".data(using: .utf8)!)
  exit(1)
}
let fifo = CommandLine.arguments[1]

// Instância única: open -na cria NOVA instância a cada chamada — duas lendo o
// mesmo FIFO racham o stream de eventos ao meio.
let lockFd = Darwin.open("/tmp/bisa-pointer.lock", O_CREAT | O_RDWR, 0o644)
if flock(lockFd, LOCK_EX | LOCK_NB) != 0 { plog("instância já ativa — saindo"); exit(0) }

let trusted = AXIsProcessTrustedWithOptions(
  [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
plog("start trusted=\(trusted) fifo=\(fifo)")

let mainB = CGDisplayBounds(CGMainDisplayID())
try? "{\"w\":\(Int(mainB.width)),\"h\":\(Int(mainB.height))}"
  .write(toFile: "/tmp/bisa-pointer.info", atomically: true, encoding: .utf8)

var pos: CGPoint = CGEvent(source: nil)?.location ?? CGPoint(x: 400, y: 400)
var leftDown = false
var absolute = false          // última posição veio do modo Pencil (não re-sincronizar)
var lastMoveAt = Date.distantPast
var lastClickAt = Date.distantPast
var clickState: Int64 = 1

func clampToDisplays(_ p: CGPoint) -> CGPoint {
  var ids = [CGDirectDisplayID](repeating: 0, count: 16)
  var count: UInt32 = 0
  CGGetActiveDisplayList(16, &ids, &count)
  for i in 0..<Int(count) where CGDisplayBounds(ids[i]).contains(p) { return p }
  let m = CGDisplayBounds(CGMainDisplayID())
  return CGPoint(x: min(max(p.x, m.minX), m.maxX - 1), y: min(max(p.y, m.minY), m.maxY - 1))
}

func post(_ type: CGEventType, _ button: CGMouseButton = .left) {
  guard let ev = CGEvent(mouseEventSource: nil, mouseType: type,
                         mouseCursorPosition: pos, mouseButton: button) else { return }
  if type == .leftMouseDown || type == .leftMouseUp {
    ev.setIntegerValueField(.mouseEventClickState, value: clickState)
  }
  ev.post(tap: .cghidEventTap)
}

func handle(_ j: [String: Any]) {
  guard let t = j["t"] as? String else { return }
  switch t {
  case "m":
    // Ocioso >2s: re-sincroniza com a posição real (mouse físico pode ter mexido).
    if !leftDown, Date().timeIntervalSince(lastMoveAt) > 2,
       let real = CGEvent(source: nil)?.location { pos = real }
    lastMoveAt = Date(); absolute = false
    let dx = (j["dx"] as? Double) ?? 0, dy = (j["dy"] as? Double) ?? 0
    pos = clampToDisplays(CGPoint(x: pos.x + dx, y: pos.y + dy))
    post(leftDown ? .leftMouseDragged : .mouseMoved)
  case "a":
    // Modo Pencil: coordenada normalizada 0..1 mapeada na tela principal.
    lastMoveAt = Date(); absolute = true
    let nx = min(max((j["x"] as? Double) ?? 0.5, 0), 1)
    let ny = min(max((j["y"] as? Double) ?? 0.5, 0), 1)
    pos = CGPoint(x: mainB.minX + nx * (mainB.width - 1),
                  y: mainB.minY + ny * (mainB.height - 1))
    post(leftDown ? .leftMouseDragged : .mouseMoved)
  case "c":
    if !leftDown, !absolute, let real = CGEvent(source: nil)?.location { pos = real }
    let b = (j["b"] as? String) ?? "l"
    let k = (j["k"] as? String) ?? "click"
    if b == "l" {
      // clickState também em down/up (modo Pencil manda pares down/up — sem
      // isto, dois taps rápidos nunca virariam double-click nos apps)
      if k == "down" {
        clickState = Date().timeIntervalSince(lastClickAt) < 0.35 ? min(clickState + 1, 3) : 1
        leftDown = true; post(.leftMouseDown)
      } else if k == "up" {
        lastClickAt = Date()
        leftDown = false; post(.leftMouseUp)
      } else {
        clickState = Date().timeIntervalSince(lastClickAt) < 0.35 ? min(clickState + 1, 3) : 1
        lastClickAt = Date()
        post(.leftMouseDown); post(.leftMouseUp)
      }
    } else {
      post(.rightMouseDown, .right); post(.rightMouseUp, .right)
    }
  case "s":
    let dy = Int32((j["dy"] as? Double) ?? 0), dx = Int32((j["dx"] as? Double) ?? 0)
    if let ev = CGEvent(scrollWheelEvent2Source: nil, units: .pixel,
                        wheelCount: 2, wheel1: dy, wheel2: dx, wheel3: 0) {
      ev.post(tap: .cghidEventTap)
    }
  default: break
  }
}

// Loop do FIFO: open bloqueia até ter escritor; EOF (escritor caiu) → reabre.
var buf = Data()
while true {
  guard let h = FileHandle(forReadingAtPath: fifo) else {
    Thread.sleep(forTimeInterval: 0.5); continue
  }
  plog("fifo aberto")
  while true {
    let chunk = h.availableData
    if chunk.isEmpty { break }
    buf.append(chunk)
    while let nl = buf.firstIndex(of: 0x0A) {
      let line = buf.subdata(in: buf.startIndex..<nl)
      buf.removeSubrange(buf.startIndex...nl)
      if let j = (try? JSONSerialization.jsonObject(with: line)) as? [String: Any] { handle(j) }
    }
  }
  h.closeFile()
  plog("fifo EOF — reabrindo")
}
