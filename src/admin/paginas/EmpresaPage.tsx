import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Aviso, Botao, Campo, Cartao, TituloPagina } from "../../shared/ui.tsx";
import { mensagemErro } from "../../lib/erros.ts";

/*
  Dados da empresa emissora do comprovante (tarefa 7) — registro único,
  editado aqui. Nasce vazio de propósito: nenhum campo vem preenchido com
  dado inventado. O comprovante só mostra o que estiver aqui; campo vazio
  simplesmente não aparece nele, em vez de ficar em branco ou com placeholder.
*/
export function EmpresaPage() {
  const empresa = useQuery(api.admin.empresa.obter);
  const salvar = useMutation(api.admin.empresa.salvar);
  const gerarUrlUpload = useMutation(api.admin.empresa.gerarUrlUpload);

  const [razaoSocial, setRazaoSocial] = useState("");
  const [nomeFantasia, setNomeFantasia] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [inscricaoEstadual, setInscricaoEstadual] = useState("");
  const [endereco, setEndereco] = useState("");
  const [telefone, setTelefone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [carregado, setCarregado] = useState(false);

  // Pré-carrega o formulário com o que já existe — só na primeira vez que a
  // query resolver, para não sobrescrever o que o Admin está digitando a
  // cada re-render.
  useEffect(() => {
    if (empresa === undefined || carregado) return;
    if (empresa !== null) {
      setRazaoSocial(empresa.razaoSocial ?? "");
      setNomeFantasia(empresa.nomeFantasia ?? "");
      setCnpj(empresa.cnpj ?? "");
      setInscricaoEstadual(empresa.inscricaoEstadual ?? "");
      setEndereco(empresa.endereco ?? "");
      setTelefone(empresa.telefone ?? "");
      setWhatsapp(empresa.whatsapp ?? "");
      setEmail(empresa.email ?? "");
    }
    setCarregado(true);
  }, [empresa, carregado]);

  async function salvarFormulario() {
    setErro("");
    setSalvo(false);
    setSalvando(true);
    try {
      let logoStorageId: Id<"_storage"> | undefined;
      if (logoFile) {
        const url = await gerarUrlUpload();
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": logoFile.type },
          body: logoFile,
        });
        if (!resp.ok) throw new Error("Falha ao enviar a logo.");
        const json = (await resp.json()) as { storageId: Id<"_storage"> };
        logoStorageId = json.storageId;
      }
      await salvar({
        razaoSocial,
        nomeFantasia,
        cnpj,
        inscricaoEstadual,
        endereco,
        telefone,
        whatsapp,
        email,
        logoStorageId,
      });
      setLogoFile(null);
      setSalvo(true);
      setTimeout(() => setSalvo(false), 2500);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setSalvando(false);
    }
  }

  if (empresa === undefined) {
    return <TituloPagina titulo="Empresa" subtitulo="Dados que aparecem no cabeçalho do comprovante de saída." />;
  }

  return (
    <>
      <TituloPagina titulo="Empresa" subtitulo="Dados que aparecem no cabeçalho do comprovante de saída." />

      {empresa === null ? (
        <div className="mb-4">
          <Aviso tom="info">
            Nenhum dado cadastrado ainda — preencha abaixo. Enquanto um campo estiver vazio, o comprovante
            simplesmente não mostra aquela linha (nada de placeholder inventado).
          </Aviso>
        </div>
      ) : null}

      <Cartao className="p-5">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Campo label="Razão social" value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} />
          <Campo label="Nome fantasia" value={nomeFantasia} onChange={(e) => setNomeFantasia(e.target.value)} />
          <Campo label="CNPJ" value={cnpj} onChange={(e) => setCnpj(e.target.value)} mono />
          <Campo
            label="Inscrição estadual (opcional)"
            value={inscricaoEstadual}
            onChange={(e) => setInscricaoEstadual(e.target.value)}
            mono
          />
          <Campo label="Telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
          <Campo label="WhatsApp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
          <Campo label="E-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Campo label="Endereço completo" value={endereco} onChange={(e) => setEndereco(e.target.value)} />
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <span className="text-xs font-medium text-texto-suave">Logo</span>
          {empresa?.logoUrl ? (
            <img
              src={empresa.logoUrl}
              alt="Logo atual"
              className="h-12 w-auto rounded border border-borda object-contain"
            />
          ) : null}
          <input
            type="file"
            accept="image/*"
            onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)}
            className="text-sm text-texto-suave"
          />
        </div>

        {erro ? (
          <div className="mt-3">
            <Aviso>{erro}</Aviso>
          </div>
        ) : null}

        <div className="mt-4 flex items-center gap-3">
          <Botao onClick={salvarFormulario} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar"}
          </Botao>
          {salvo ? <span className="text-sm text-entrada">Salvo.</span> : null}
        </div>
      </Cartao>
    </>
  );
}
