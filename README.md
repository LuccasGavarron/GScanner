# GScanner

Assistente de Escape from Tarkov para segundo monitor ou celular.

## O que faz
- **Mapa:** mostra onde você está quando aperta Print Screen no jogo, com a direção para onde olha. Troca de mapa sozinho ao entrar na raid. Clique no mapa para pingar; clique no ping para apagar.
- **Munição:** tabela por calibre com dano, penetração, dano na armadura, fragmentação, velocidade, preço e cores por classe de armadura.

## Como rodar
1. Instale o Node 22 ou mais novo.
2. Rode `npm start` nesta pasta.
3. Abra `http://localhost:7777`. O terminal também mostra o endereço para o celular na mesma rede.

Se as pastas do jogo forem outras, defina `EFT_SCREENSHOTS` e `EFT_LOGS` antes do `npm start`.

## Por que é seguro
O GScanner não toca no processo do jogo: não lê memória, não lê rede e não injeta nada. Ele só usa:
- o nome dos arquivos de screenshot, que o jogo grava com a posição;
- os logs que o jogo grava na pasta `Logs`;
- dados públicos do [tarkov.dev](https://tarkov.dev).

## Testes
`npm test`
