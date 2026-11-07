# GScanner

Assistente de Escape from Tarkov para segundo monitor ou celular.

## O que faz
- **Mapa:** mostra onde você está quando tira screenshot no jogo, com a direção para onde olha. Troca de mapa ao entrar na raid e de andar pela sua altura. Clique no mapa para pingar; clique no ping para apagar.
- **Munição:** tabela por calibre com dano, penetração, dano na armadura, fragmentação, velocidade, preço e cores por classe de armadura.
- **Preço:** busca item por nome, compara flea com o melhor trader, mostra o preço por slot e avisa se o item serve para quest.
- **Armas:** monta a build com menos recuo, mais ergonomia ou equilibrada, dentro do orçamento, do nível dos traders e com ou sem flea.

Sem tecla Print Screen: no jogo, troque o atalho de screenshot para outra tecla em Settings → Controls.

## Como rodar
1. Instale o Node 22 ou mais novo.
2. Rode `npm start` nesta pasta.
3. Abra `http://localhost:7777`. O terminal também mostra o endereço para o celular na mesma rede.

Se as pastas do jogo forem outras, defina `EFT_SCREENSHOTS` e `EFT_LOGS` antes do `npm start`.

Os dados do tarkov.dev ficam copiados em `cache/`. Se a API cair, o app usa a última cópia e mostra a data dela.

## Por que é seguro
O GScanner não toca no processo do jogo: não lê memória, não lê rede e não injeta nada. Ele só usa:
- o nome dos arquivos de screenshot, que o jogo grava com a posição;
- os logs que o jogo grava na pasta `Logs`;
- dados públicos do [tarkov.dev](https://tarkov.dev).

## Testes
`npm test`

## Jogar com amigos (squad)
Cada amigo roda o próprio GScanner. Um de vocês é o anfitrião.

1. No anfitrião, crie `config.json` nesta pasta: `{ "squadName": "SeuNome", "squadKey": "senha-do-grupo" }`.
2. Em cada amigo, crie `config.json`: `{ "squadName": "NomeDele", "squadKey": "senha-do-grupo", "squadUrl": "http://IP-DO-ANFITRIAO:7777" }`.
3. Rode `npm start` em todos.

O anfitrião precisa estar acessível pelos amigos: mesma rede, Tailscale ou a porta 7777 liberada no roteador. Sem a senha certa, o anfitrião recusa a posição. Cada print no jogo atualiza a sua posição no mapa dos outros, e o ping (clique no mapa) aparece para todos.
