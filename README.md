# Ishikawa

Diagramas de causa e efeito (espinha de peixe) para Windows, com plano de ação, exportação em PDF e sincronização entre computadores pelo Google Drive.

## Baixar

Pegue o `Ishikawa.exe` na página de [Releases](../../releases/latest) e abra. Não precisa instalar nada: o programa usa o Edge (ou o Chrome) que já está no Windows para mostrar a janela.

Como o arquivo não é assinado, o Windows pode mostrar o aviso do SmartScreen na primeira vez: clique em **Mais informações** e depois em **Executar assim mesmo**.

## No celular (versão web)

Abra **https://joaogabrielmontinirossi-sys.github.io/ishikawa/** no navegador do celular.

- **Android (Chrome)**: toque em **Instalar o aplicativo** no menu lateral (ou em ⋮ › *Instalar app*). O Ishikawa ganha ícone na tela inicial e abre em tela cheia.
- **iPhone/iPad (Safari)**: toque em **Compartilhar** › **Adicionar à Tela de Início**.

Depois de aberta uma vez, a versão web funciona sem internet. Os diagramas ficam guardados no próprio aparelho; para levá-los ao computador (ou trazê-los de lá), use **Ajustes › Exportar backup** e **Importar…**. No quadro, arraste com um dedo para mover, faça a pinça para ampliar e toque duas vezes num item para editar o texto.

A cada alteração na pasta `app/` da branch `main`, o GitHub Actions publica a versão nova automaticamente (`.github/workflows/web.yml`).

## O que ele faz

- **Diagrama desenhado sozinho**: efeito, categorias, causas e subcausas são posicionados automaticamente, sem sobreposição.
- **Modelos prontos**: 6M, Serviços, 4P, 8P, 4S ou em branco.
- **Edição rápida**: digite na estrutura ao lado ou dê dois cliques direto no desenho.
  - `Enter` novo item · `Ctrl+Enter` item dentro · `Tab` / `Shift+Tab` muda o nível · `Alt+↑↓` reordena · `Ctrl+Z` / `Ctrl+Y` desfaz e refaz
- **Análise**: marque a causa raiz (★), a situação de cada causa (hipótese, confirmada ✓, descartada), votos da equipe (▲) e observações.
- **Plano de ação 5W2H** ligado às causas.
- **Exportação**: PDF (A4 ou A3, com a lista de causas e o plano de ação), PNG, SVG e arquivo `.json`.
- **Vários diagramas**, pesquisa, duplicar, lixeira, tema claro e escuro.

## Sincronização

Funciona como no [Capynote](https://github.com/joaogabrielmontinirossi-sys/capynote): o Ishikawa grava o arquivo `ishikawa-sync.json` numa pasta do Google Drive para computador (`Meu Drive\Ishikawa`) a cada alteração, e o Drive o leva aos outros aparelhos. Outro computador com o Ishikawa e o mesmo Drive recebe os diagramas automaticamente.

- Se o Google Drive para computador estiver instalado, a sincronização já começa ligada.
- Em **Ajustes** dá para desativar, trocar de conta (cada unidade G:, H:… é uma conta) ou escolher qualquer outra pasta sincronizada (OneDrive, Dropbox…).
- Alterações feitas em dois aparelhos são mescladas por diagrama: vale a versão mais recente de cada um, e exclusões também são propagadas.

Sem sincronização, os dados ficam só neste computador (em `%LOCALAPPDATA%\Ishikawa`). Use **Ajustes › Exportar backup** para levar tudo a outro lugar.

## Compilar

Só precisa do Windows (usa o compilador C# do .NET Framework e o Edge, que já vêm instalados):

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

Gera `dist\Ishikawa.exe` e `dist\ishikawa.html` (versão em arquivo único, que abre em qualquer navegador; nela a sincronização automática não está disponível, apenas o backup).

| Pasta | Conteúdo |
| --- | --- |
| `app/` | O aplicativo (HTML, CSS e JavaScript puros, sem dependências) |
| `desktop/Ishikawa.cs` | Programa de Windows: serve o app em `localhost`, grava a pasta de sincronização e gera o PDF |
| `build.ps1` | Gera os ícones, compila o `.exe` e monta o arquivo único |
