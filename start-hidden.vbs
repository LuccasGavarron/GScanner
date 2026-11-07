' Abre o servidor do GScanner sem janela. Atalho na pasta Inicializar do Windows aponta para este arquivo.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.Run "node server.js", 0, False
