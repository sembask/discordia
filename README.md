# Discordia

Chat de voz e compartilhamento de tela com os amigos: simples como o Discord,
sem cadastro e sem anúncio. A voz e a tela vão **direto de um PC pro outro**
(WebRTC), criptografadas, com a menor latência possível.

- **Voz**: Opus a 48 kHz, até 96 kbps (voz) ou **256 kbps em estéreo** no modo
  alta fidelidade (música/instrumento). Supressão de ruído, cancelamento de eco,
  volume individual por amigo e indicador de quem está falando.
- **Tela**: 720p, 1080p, 1440p, **4K** ou resolução original, a 15/30/**60 fps**.
  Modo "Movimento" (jogo/vídeo) ou "Texto" (código/documento nítido). Escolhe
  sozinho o codec que sua placa de vídeo faz em hardware (AV1, VP9 ou H.264).
  No Windows, transmite também o **áudio do computador**.
- **Chat de texto** na sala, com histórico curto e links clicáveis.
- **Tema claro, escuro ou do sistema.**
- **Apps para Windows, macOS e Linux**, e uma versão web (entra pelo navegador
  sem instalar).

## Como funciona

```
  App (Electron)  ──── WebSocket ────▶  Servidor  ◀──── WebSocket ────  App
        │            (só "sinalização":  (Node, leve)                    │
        │             quem está na sala,                                 │
        │             ofertas WebRTC, chat)                              │
        └──────────────── voz + tela (WebRTC, P2P, criptografado) ───────┘
```

O servidor nunca recebe áudio nem vídeo, então uma máquina simples aguenta muita
gente. Cada sala aceita até 12 pessoas (malha ponto a ponto: quem transmite a
tela manda uma cópia pra cada amigo).

```
discordia/
├── app/        App desktop (Electron + React + TypeScript + Tailwind)
│   ├── electron/   processo principal (janela, captura de tela, permissões)
│   └── src/        interface e o motor de chamada (src/lib/call.ts)
└── server/     Servidor de sinalização (Node + ws)
```

## Versão web (sem instalar nada)

O mesmo servidor entrega o app pelo navegador. Com ele no ar em
`https://seu.dominio`:

- Qualquer amigo entra pelo navegador (Chrome, Edge, Firefox, Safari).
- **Link de convite**: na sala, clique em *Copiar link de convite* e mande
  (`https://seu.dominio/?sala=lobo-azul-42`). Quem clica já cai na sala certa,
  só digita o nome.
- **Instala como app**: no Chrome/Edge, o ícone de instalar na barra de
  endereço cria um atalho com cara de programa.
- **Celular**: dá pra conversar e assistir a tela dos amigos. Transmitir a
  própria tela pelo celular não é suportado pelos navegadores de celular.

Web × app de baixar: os dois conversam entre si na mesma sala. O app instalado
tem o seletor de tela com miniaturas e, no Windows, o áudio do computador sem
precisar marcar nada no navegador; o resto é igual.

## Rodar no seu PC (desenvolvimento)

Requisito: Node.js 20 ou mais novo.

```bash
# 1. Servidor
cd server
npm install
npm start                # escuta em ws://localhost:8787

# 2. App (em outro terminal)
cd app
npm install
npm run dev              # abre o app desktop com recarga instantânea
```

Pra simular um amigo, abra uma segunda janela com `npm run web` (versão
navegador em http://localhost:5173) ou rode o app em outro PC da mesma rede
apontando pro IP da sua máquina (Configurações → Servidor).

Testes do servidor: `cd server && npm test`.
Checagem de tipos do app: `cd app && npm run typecheck`.

## Colocar o servidor no ar

Pra jogar com amigos de fora da sua casa, o servidor precisa estar num lugar
que todos alcancem (uma VPS, por exemplo).

### Com Docker

```bash
docker compose up -d     # sobe na porta 8787
```

Ou sem compose: `docker build -t discordia . && docker run -d -p 8787:8787 discordia`.

Abrindo `http://SEU_IP:8787` no navegador você já entra numa sala pela versão web.

### Com HTTPS (recomendado)

Coloque o container atrás de um proxy com certificado (EasyPanel, Caddy,
Nginx, Traefik…) apontando um domínio pra porta **8787**. Aí o endereço do
servidor no app fica `wss://seu.dominio.com`. O proxy precisa permitir
WebSocket (EasyPanel e Caddy já permitem por padrão).

> Navegadores exigem HTTPS pra liberar o microfone fora do `localhost`. O app
> desktop não tem essa restrição, mas a versão web sim.

### TURN (quando alguém não consegue conectar)

Na maioria das casas a conexão direta funciona. Em redes muito fechadas (NAT de
operadora 4G/5G, rede de empresa ou faculdade) os PCs não conseguem se ligar e
precisam de um **servidor TURN** que retransmite a mídia. O `docker-compose.yml`
já traz um (coturn):

```bash
# arquivo .env ao lado do docker-compose.yml
TURN_SECRET=coloque-aqui-uma-senha-longa-e-aleatoria
PUBLIC_IP=203.0.113.10
TURN_URLS=turn:203.0.113.10:3478,turn:203.0.113.10:3478?transport=tcp
```

```bash
docker compose --profile turn up -d
```

Libere no firewall: `3478/udp`, `3478/tcp` e `49160-49200/udp`. O servidor do
Discordia gera credenciais temporárias pro TURN sozinho, ninguém precisa digitar
senha.

## Gerar os instaladores (pra mandar pros amigos)

O GitHub Actions gera tudo automaticamente:

1. (Opcional) Em **Settings → Secrets and variables → Actions → Variables**, crie
   `DISCORDIA_SERVER` com o endereço do seu servidor (ex.:
   `wss://discordia.seudominio.com`). Ele vem preenchido no app.
2. Crie uma tag de versão:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. Em alguns minutos aparece uma **Release** com:
   - `Discordia-0.1.0-win-x64.exe` (Windows)
   - `Discordia-0.1.0-mac-arm64.dmg` (macOS Apple Silicon)
   - `Discordia-0.1.0-linux-x86_64.AppImage` (Linux)

Pra gerar localmente: `cd app && npm run dist:win` (ou `dist:mac`, `dist:linux`).

**Primeira abertura**: os instaladores não são assinados (certificado de
assinatura é pago), então o sistema avisa uma vez:

- **Windows**: "O Windows protegeu o computador" → *Mais informações* →
  *Executar assim mesmo*.
- **macOS**: clique com o botão direito no app → *Abrir*. Na primeira
  transmissão, libere "Gravação de Tela" pro Discordia em *Ajustes do Sistema →
  Privacidade e Segurança*.

## Usando

1. Digite seu nome, clique em **Criar e entrar** e mande o **link de convite**
   (botão na barra lateral) ou só o código da sala.
2. Quem recebe o link clica e entra; quem recebe o código escolhe **Tenho um
   código** e cola.
3. **Compartilhar tela** → escolha a tela ou janela, a resolução e o fps →
   **Transmitir**. Duplo clique no vídeo de um amigo abre em tela cheia; passe o
   mouse por cima pra ver resolução, fps, bitrate e codec ao vivo.

Atalhos: `Ctrl+Shift+M` muta, `Ctrl+Shift+D` ensurdece.

### Quanto de internet precisa

Quem transmite manda uma cópia da tela pra cada amigo. Valores aproximados de
**upload** por amigo assistindo:

| Qualidade      | Movimento | Texto  |
| -------------- | --------- | ------ |
| 720p 30 fps    | 1,9 Mb/s  | 2,5 Mb/s |
| 1080p 60 fps   | 8,7 Mb/s  | 11 Mb/s |
| 1440p 60 fps   | 15 Mb/s   | 20 Mb/s |
| 4K 60 fps      | 35 Mb/s   | 40 Mb/s |

Se a internet não der conta, o WebRTC baixa a qualidade sozinho (no modo
Movimento ele mantém o fps e reduz a resolução; no modo Texto, o contrário).
A voz usa ~0,1 Mb/s por amigo (0,25 no modo alta fidelidade).

### Áudio do computador

Disponível no Windows. Ele captura **tudo** que toca no PC, inclusive a voz dos
amigos na chamada. Use fone de ouvido e, se alguém reclamar de eco da própria
voz, desligue a opção ao transmitir.
