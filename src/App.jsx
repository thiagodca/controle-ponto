import React, { useState, useEffect } from 'react';
import { Clock, Users, FileText, LogOut, LogIn, UserPlus, Edit2, Trash2, Save, X, Plus, Search, Download, MapPin, AlertTriangle } from 'lucide-react';
import { MapContainer, TileLayer, Marker } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Identificador de versão — usado para confirmar visualmente qual versão do código está rodando
const APP_VERSION = 'v3.8-resolver-inconsistencias';

// Ícone customizado do marcador (evita o bug clássico do Leaflet + Vite com os
// ícones padrão, que não carregam corretamente após o build).
const marcadorIcon = L.divIcon({
  html: '<div style="font-size: 36px; line-height: 1; transform: translateY(-8px);">📍</div>',
  className: '',
  iconSize: [36, 36],
  iconAnchor: [18, 36],
});

// Configuração do banco de dados (Supabase)
const SUPABASE_URL = 'https://rnabihjpvnvyrvpwpyjv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Mm_lgPs-Zvni1xmdNEvZxA_ZlmbXYHN';

// Função auxiliar para chamadas à API REST do Supabase (PostgREST)
const supabaseRequest = async (table, method = 'GET', { query = '', body = null } = {}) => {
  const url = `${SUPABASE_URL}/rest/v1/${table}${query}`;
  const headers = {
    'apikey': SUPABASE_KEY,
    'Authorization': `Bearer ${SUPABASE_KEY}`,
    'Content-Type': 'application/json',
  };
  if (method !== 'GET' && method !== 'DELETE') {
    headers['Prefer'] = 'return=representation';
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Banco de dados (${method} ${table}) falhou: ${response.status} — ${errorText}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

// Conversores entre o formato do banco (snake_case) e o formato usado no app (camelCase)
const dbUserToApp = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  password: u.password,
  profile: u.profile,
  firstAccess: u.first_access,
});

const dbRecordToApp = (r) => ({
  id: r.id,
  userId: r.user_id,
  userName: r.user_name,
  date: r.date,
  time: r.time,
  datetime: r.datetime,
  type: r.type,
  latitude: r.latitude,
  longitude: r.longitude,
  address: r.address,
  manuallyAdjusted: r.manually_adjusted || false,
});

// Obtém a localização atual do navegador (com timeout) e retorna coordenadas.
// Se a pessoa negar a permissão ou o dispositivo não suportar, retorna null
// em vez de travar o registro de ponto — a localização é um "extra", não deve
// impedir o funcionário de bater o ponto.
// Verifica o estado atual da permissão de geolocalização, sem disparar o
// pedido de permissão do navegador. Retorna 'granted', 'denied', 'prompt'
// (ainda não decidido) ou 'unknown' (navegador não suporta essa checagem).
const checkGeoPermission = async () => {
  if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' });
    return status.state;
  } catch {
    return 'unknown';
  }
};

const getCurrentPosition = () => {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve({ position: null, errorReason: 'Navegador não suporta geolocalização' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          position: {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          },
          errorReason: null,
        });
      },
      (error) => {
        // Reporta o motivo exato da falha, para sabermos se foi permissão
        // negada, GPS indisponível, ou tempo esgotado.
        const motivos = {
          1: 'Permissão de localização negada',
          2: 'Localização indisponível no dispositivo',
          3: 'Tempo esgotado ao obter localização',
        };
        resolve({ position: null, errorReason: motivos[error.code] || 'Erro desconhecido de localização' });
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
};

// Converte coordenadas em um endereço legível usando o serviço gratuito
// Nominatim (OpenStreetMap). Se falhar, retorna null (não bloqueia o ponto).
const reverseGeocode = async (latitude, longitude) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      headers: { 'Accept-Language': 'pt-BR' },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.display_name || null;
  } catch (error) {
    console.warn('Não foi possível obter o endereço:', error.message);
    return null;
  }
};

const ControlePonto = () => {
  // Estado para autenticação
  const [currentUser, setCurrentUser] = useState(null);
  const [showLogin, setShowLogin] = useState(true);
  const [showPasswordSetup, setShowPasswordSetup] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // Estado para navegação
  const [activeView, setActiveView] = useState('clock');
  
  // Estado para usuários
  const [users, setUsers] = useState([]);
  const [editingUser, setEditingUser] = useState(null);
  const [newUser, setNewUser] = useState({ name: '', email: '', profile: 'employee' });
  const [showUserForm, setShowUserForm] = useState(false);
  
  // Estado para registros de ponto
  const [timeRecords, setTimeRecords] = useState([]);
  const [holidays, setHolidays] = useState([]); // array de strings 'YYYY-MM-DD'
  
  // Estado para consulta
  const [filterName, setFilterName] = useState('');
  const [filterMonth, setFilterMonth] = useState('');
  const [filterYear, setFilterYear] = useState('');
  
  // Estado para relatório — mês e ano do relatório vêm pré-selecionados com o mês atual
  const nowParaDefaults = new Date();
  const [reportUser, setReportUser] = useState('');
  const [reportMonth, setReportMonth] = useState(String(nowParaDefaults.getMonth() + 1).padStart(2, '0'));
  const [reportYear, setReportYear] = useState(String(nowParaDefaults.getFullYear()));

  // Estado para a tela de Inconsistências
  const [inconsistencyUser, setInconsistencyUser] = useState('');
  const [inconsistencyMonth, setInconsistencyMonth] = useState(String(nowParaDefaults.getMonth() + 1).padStart(2, '0'));
  const [inconsistencyYear, setInconsistencyYear] = useState(String(nowParaDefaults.getFullYear()));

  // Estado para o modal de resolução de inconsistência
  const [resolveModalOpen, setResolveModalOpen] = useState(false);
  const [resolveModalTab, setResolveModalTab] = useState('horarios'); // 'horarios' | 'feriado'
  const [resolveDate, setResolveDate] = useState('');
  const [resolveEntrada, setResolveEntrada] = useState('');
  const [resolveInicioIntervalo, setResolveInicioIntervalo] = useState('');
  const [resolveFimIntervalo, setResolveFimIntervalo] = useState('');
  const [resolveSaida, setResolveSaida] = useState('');
  const [resolveHolidayDesc, setResolveHolidayDesc] = useState('Feriado');
  const [resolveError, setResolveError] = useState('');
  const [resolveSaving, setResolveSaving] = useState(false);
  
  // Estado de carregamento inicial e mensagens de erro (inline, não usa alert)
  const [isLoading, setIsLoading] = useState(true);
  const [loginError, setLoginError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [clockMessage, setClockMessage] = useState(null);
  const [loadError, setLoadError] = useState('');

  const [storageAvailable, setStorageAvailable] = useState(true);

  // Carregar dados do Supabase ao montar
  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    setLoadError('');
    try {
      const usuarios = await supabaseRequest('usuarios', 'GET', { query: '?select=*&order=created_at.asc' });
      setUsers((usuarios || []).map(dbUserToApp));

      const registros = await supabaseRequest('registros_ponto', 'GET', { query: '?select=*&order=datetime.asc' });
      setTimeRecords((registros || []).map(dbRecordToApp));

      const feriadosDb = await supabaseRequest('feriados', 'GET', { query: '?select=*' });
      setHolidays((feriadosDb || []).map(f => f.date));

      setStorageAvailable(true);
    } catch (error) {
      console.error('Erro ao carregar dados do banco:', error);
      setLoadError(error.message || 'Falha ao conectar com o banco de dados.');
      setStorageAvailable(false);
    } finally {
      setIsLoading(false);
    }
  };

  // Função de login
  const handleLogin = () => {
    try {
      setLoginError('');
      const emailNormalizado = String(loginEmail || '').trim().toLowerCase();
      const senhaDigitada = String(loginPassword || '');
      
      if (!emailNormalizado || !senhaDigitada) {
        setLoginError('Preencha e-mail e senha.');
        return;
      }
      
      const user = users.find(u => 
        String(u.email || '').trim().toLowerCase() === emailNormalizado && 
        String(u.password || '') === senhaDigitada
      );
      
      if (user) {
        if (user.firstAccess) {
          setLoginEmail(emailNormalizado);
          setShowPasswordSetup(true);
          setLoginPassword(''); // Limpa apenas a senha
        } else {
          setCurrentUser(user);
          setShowLogin(false);
          setActiveView(user.profile === 'admin' ? 'users' : 'clock');
          setLoginEmail('');
          setLoginPassword('');
        }
      } else {
        setLoginError('E-mail ou senha incorretos. Verifique e tente novamente.');
      }
    } catch (error) {
      console.error('Erro no login:', error);
      setLoginError('Erro inesperado ao entrar: ' + error.message);
    }
  };

  // Função para configurar senha no primeiro acesso
  const handlePasswordSetup = async () => {
    setPasswordError('');
    try {
      if (newPassword !== confirmPassword) {
        setPasswordError('As senhas não coincidem!');
        return;
      }
      if (newPassword.length < 4) {
        setPasswordError('A senha deve ter pelo menos 4 caracteres!');
        return;
      }
      
      if (!loginEmail) {
        setPasswordError('E-mail não encontrado. Volte e faça login novamente.');
        setShowPasswordSetup(false);
        return;
      }
      
      const emailNormalizado = String(loginEmail).trim().toLowerCase();
      const userAtual = users.find(u => String(u.email || '').trim().toLowerCase() === emailNormalizado);
      
      if (!userAtual) {
        setPasswordError('Usuário não encontrado. Tente fazer login novamente.');
        return;
      }

      const atualizados = await supabaseRequest('usuarios', 'PATCH', {
        query: `?id=eq.${userAtual.id}`,
        body: { password: newPassword, first_access: false }
      });
      const userAtualizado = dbUserToApp(atualizados[0]);

      setUsers(users.map(u => u.id === userAtualizado.id ? userAtualizado : u));
      setCurrentUser(userAtualizado);
      setShowPasswordSetup(false);
      setShowLogin(false);
      setActiveView(userAtualizado.profile === 'admin' ? 'users' : 'clock');
      setNewPassword('');
      setConfirmPassword('');
      setLoginEmail('');
    } catch (error) {
      console.error('Erro ao configurar senha:', error);
      setPasswordError('Erro ao salvar a nova senha: ' + error.message);
    }
  };

  // Função de logout
  const handleLogout = () => {
    setCurrentUser(null);
    setShowLogin(true);
    setActiveView('clock');
    setLoginError('');
    setPasswordError('');
  };

  // Backup manual: baixa um arquivo .json com todos os dados (usuários e registros).
  // Serve como cópia de segurança independente do armazenamento automático —
  // pode ser guardado ou enviado por WhatsApp/e-mail se algo der errado.
  const handleExportBackup = () => {
    try {
      const backup = {
        exportedAt: new Date().toISOString(),
        users,
        timeRecords
      };
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dataHoje = new Date().toISOString().split('T')[0];
      a.href = url;
      a.download = `backup-controle-ponto-${dataHoje}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erro ao exportar backup:', error);
      alert('Não foi possível gerar o arquivo de backup.');
    }
  };

  // Restaura dados a partir de um arquivo .json exportado anteriormente,
  // recriando os registros no banco de dados (Supabase).
  const handleImportBackup = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const backup = JSON.parse(e.target.result);
        if (!Array.isArray(backup.users)) {
          throw new Error('Arquivo inválido: não contém uma lista de usuários.');
        }
        if (!window.confirm(`Importar este backup vai ADICIONAR estes dados ao banco atual (não apaga o que já existe).\n\nUsuários no arquivo: ${backup.users.length}\nRegistros no arquivo: ${(backup.timeRecords || []).length}\nData do backup: ${backup.exportedAt ? new Date(backup.exportedAt).toLocaleString('pt-BR') : 'desconhecida'}\n\nDeseja continuar?`)) {
          return;
        }
        alert('Importação de backup para o banco de dados ainda não está disponível nesta versão. Use "Novo Usuário" para recadastrar manualmente, se necessário.');
      } catch (error) {
        console.error('Erro ao importar backup:', error);
        alert('Não foi possível importar o arquivo: ' + error.message);
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  // Funções para gerenciamento de usuários
  const handleAddUser = async () => {
    if (!newUser.name || !newUser.email) {
      alert('Preencha todos os campos!');
      return;
    }
    
    if (users.find(u => u.email.toLowerCase() === newUser.email.toLowerCase())) {
      alert('Este e-mail já está cadastrado!');
      return;
    }

    try {
      const inseridos = await supabaseRequest('usuarios', 'POST', {
        body: {
          name: newUser.name,
          email: newUser.email.trim().toLowerCase(),
          password: '123456',
          profile: newUser.profile,
          first_access: true,
        }
      });
      const novoUsuario = dbUserToApp(inseridos[0]);
      setUsers([...users, novoUsuario]);
      setNewUser({ name: '', email: '', profile: 'employee' });
      setShowUserForm(false);
      alert('Usuário cadastrado com sucesso! Senha padrão: 123456');
    } catch (error) {
      console.error('Erro ao cadastrar usuário:', error);
      alert('Não foi possível cadastrar o usuário: ' + error.message);
    }
  };

  const handleEditUser = (user) => {
    setEditingUser({ ...user });
  };

  const handleSaveEdit = async () => {
    try {
      const atualizados = await supabaseRequest('usuarios', 'PATCH', {
        query: `?id=eq.${editingUser.id}`,
        body: {
          name: editingUser.name,
          email: editingUser.email.trim().toLowerCase(),
          profile: editingUser.profile,
        }
      });
      const userAtualizado = dbUserToApp(atualizados[0]);
      setUsers(users.map(u => u.id === userAtualizado.id ? userAtualizado : u));
      setEditingUser(null);
    } catch (error) {
      console.error('Erro ao salvar edição:', error);
      alert('Não foi possível salvar a edição: ' + error.message);
    }
  };

  const handleDeleteUser = async (id) => {
    const userParaExcluir = users.find(u => u.id === id);
    if (userParaExcluir && userParaExcluir.email === 'admin@admin.com') {
      alert('Não é possível excluir o administrador padrão!');
      return;
    }
    if (window.confirm('Tem certeza que deseja excluir este usuário?')) {
      try {
        await supabaseRequest('usuarios', 'DELETE', { query: `?id=eq.${id}` });
        setUsers(users.filter(u => u.id !== id));
      } catch (error) {
        console.error('Erro ao excluir usuário:', error);
        alert('Não foi possível excluir o usuário: ' + error.message);
      }
    }
  };

  // Fluxo de registro de ponto com confirmação por mapa
  const [clockModalOpen, setClockModalOpen] = useState(false);
  // status: 'checking-permission' | 'permission-denied' | 'loading-location' | 'geocoding' | 'ready' | 'error'
  const [clockModalStatus, setClockModalStatus] = useState('checking-permission');
  const [clockModalPosition, setClockModalPosition] = useState(null);
  const [clockModalAddress, setClockModalAddress] = useState(null);
  const [clockModalErrorMsg, setClockModalErrorMsg] = useState('');
  const [isConfirmingClockIn, setIsConfirmingClockIn] = useState(false);

  // Ao tocar em "Registrar Ponto": abre o modal e começa o processo de obter
  // a localização. O registro só é efetivado quando o usuário confirmar,
  // depois do mapa ter carregado — nunca automaticamente.
  const handleOpenClockModal = async () => {
    setClockModalOpen(true);
    setClockModalPosition(null);
    setClockModalAddress(null);
    setClockModalErrorMsg('');
    setClockModalStatus('checking-permission');

    const permissao = await checkGeoPermission();
    if (permissao === 'denied') {
      setClockModalStatus('permission-denied');
      return;
    }

    setClockModalStatus('loading-location');
    const { position, errorReason } = await getCurrentPosition();
    if (!position) {
      setClockModalErrorMsg(errorReason || 'Não foi possível obter sua localização.');
      setClockModalStatus(errorReason === 'Permissão de localização negada' ? 'permission-denied' : 'error');
      return;
    }

    setClockModalPosition(position);
    setClockModalStatus('geocoding');
    const endereco = await reverseGeocode(position.latitude, position.longitude);
    setClockModalAddress(endereco);
    setClockModalStatus('ready');
  };

  const handleCloseClockModal = () => {
    setClockModalOpen(false);
    setClockModalStatus('checking-permission');
    setClockModalPosition(null);
    setClockModalAddress(null);
    setClockModalErrorMsg('');
  };

  // Executa de fato o registro do ponto — só é chamado depois que o usuário
  // confirma no modal, com o mapa já carregado.
  const handleConfirmClockIn = async () => {
    if (!currentUser || !clockModalPosition) return;
    setIsConfirmingClockIn(true);

    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const todayRecords = timeRecords.filter(r => 
      r.userId === currentUser.id && r.date === today
    );
    const type = todayRecords.length % 2 === 0 ? 'entrada' : 'saída';

    try {
      const inseridos = await supabaseRequest('registros_ponto', 'POST', {
        body: {
          user_id: currentUser.id,
          user_name: currentUser.name,
          date: today,
          time: now.toTimeString().split(' ')[0],
          datetime: now.toISOString(),
          type,
          latitude: clockModalPosition.latitude,
          longitude: clockModalPosition.longitude,
          address: clockModalAddress,
        }
      });
      const novoRegistro = dbRecordToApp(inseridos[0]);
      setTimeRecords([...timeRecords, novoRegistro]);
      const avisoEndereco = clockModalAddress ? '' : ' (endereço não identificado)';
      setClockMessage({ text: `Ponto registrado: ${type.toUpperCase()} às ${novoRegistro.time}${avisoEndereco}`, error: false });
      handleCloseClockModal();
    } catch (error) {
      console.error('Erro ao salvar registro de ponto:', error);
      setClockMessage({ text: 'Erro ao salvar o ponto: ' + error.message, error: true });
      handleCloseClockModal();
    } finally {
      setIsConfirmingClockIn(false);
    }

    setTimeout(() => setClockMessage(null), 5000);
  };

  // Função para filtrar registros
  const getFilteredRecords = () => {
    return timeRecords.filter(record => {
      const matchName = !filterName || record.userName.toLowerCase().includes(filterName.toLowerCase());
      const matchMonth = !filterMonth || record.date.substring(5, 7) === filterMonth;
      const matchYear = !filterYear || record.date.substring(0, 4) === filterYear;
      return matchName && matchMonth && matchYear;
    }).sort((a, b) => new Date(b.datetime) - new Date(a.datetime));
  };

  // Função para calcular horas trabalhadas
  // Converte "HH:MM:SS" em minutos desde a meia-noite, para facilitar cálculos
  const timeToMinutes = (timeStr) => {
    if (!timeStr) return null;
    const [h, m, s] = timeStr.split(':').map(Number);
    return h * 60 + m + (s || 0) / 60;
  };

  // Calcula as métricas de um único dia (entrada, intervalo, saída, horas
  // trabalhadas e horas extras) a partir dos registros de ponto daquele dia.
  //
  // Regras assumidas (combinadas com o usuário):
  // - 2 marcações no dia = entrada + saída, sem intervalo marcado → assume-se
  //   1 hora de intervalo automaticamente.
  // - 4 marcações no dia = entrada, início do intervalo, fim do intervalo, saída.
  // - 1 ou 3 marcações = dia incompleto (falta alguma marcação); não entra no
  //   somatório de horas.
  // - Dia sem nenhuma marcação = não trabalhado; não entra no somatório.
  const getDayMetrics = (dateStr, allRecords) => {
    const dayRecords = allRecords
      .filter(r => r.date === dateStr)
      .sort((a, b) => a.time.localeCompare(b.time));

    const punches = dayRecords.map(r => r.time);
    const n = punches.length;

    let entrada = null, inicioIntervalo = null, fimIntervalo = null, saida = null;
    let horasTrabalhadas = null;
    let status = 'sem-registro';

    if (n === 0) {
      status = 'sem-registro';
    } else if (n === 1) {
      entrada = punches[0];
      status = 'incompleto';
    } else if (n === 2) {
      entrada = punches[0];
      saida = punches[1];
      const totalMin = timeToMinutes(saida) - timeToMinutes(entrada) - 60; // assume 1h de intervalo
      horasTrabalhadas = Math.max(0, totalMin) / 60;
      status = 'completo';
    } else if (n === 3) {
      entrada = punches[0];
      inicioIntervalo = punches[1];
      fimIntervalo = punches[2];
      status = 'incompleto'; // falta a marcação de saída
    } else {
      entrada = punches[0];
      inicioIntervalo = punches[1];
      fimIntervalo = punches[2];
      saida = punches[3];
      const minTrabalhados = (timeToMinutes(inicioIntervalo) - timeToMinutes(entrada)) +
                              (timeToMinutes(saida) - timeToMinutes(fimIntervalo));
      horasTrabalhadas = Math.max(0, minTrabalhados) / 60;
      status = 'completo';
    }

    const horasExtras = horasTrabalhadas !== null ? horasTrabalhadas - 8 : null;

    const isManuallyAdjusted = dayRecords.some(r => r.manuallyAdjusted);

    return { date: dateStr, entrada, inicioIntervalo, fimIntervalo, saida, horasTrabalhadas, horasExtras, status, isManuallyAdjusted };
  };

  const formatHoraCurta = (timeStr) => timeStr ? timeStr.substring(0, 5) : '—';

  const formatHoras = (valor) => {
    if (valor === null || valor === undefined) return '—';
    const sinal = valor < 0 ? '-' : '';
    const abs = Math.abs(valor);
    const h = Math.floor(abs);
    const m = Math.round((abs - h) * 60);
    return `${sinal}${h}h${m.toString().padStart(2, '0')}`;
  };

  // Função para gerar relatório: uma linha para cada dia do mês/ano selecionado
  const generateReport = () => {
    if (!reportUser || !reportMonth || !reportYear) return null;

    const user = users.find(u => u.id === reportUser);
    const userRecords = timeRecords.filter(r => r.userId === reportUser);

    const ano = parseInt(reportYear);
    const mes = parseInt(reportMonth); // 1-12
    const diasNoMes = new Date(ano, mes, 0).getDate();

    const dias = [];
    for (let dia = 1; dia <= diasNoMes; dia++) {
      const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      dias.push(getDayMetrics(dateStr, userRecords));
    }

    const totalHorasTrabalhadas = dias.reduce((acc, d) => acc + (d.horasTrabalhadas || 0), 0);
    const totalHorasExtras = dias.reduce((acc, d) => acc + (d.horasExtras !== null ? d.horasExtras : 0), 0);

    return { user, dias, totalHorasTrabalhadas, totalHorasExtras };
  };

  // Gera a lista de inconsistências (dias com 1 ou 3 marcações) de um
  // funcionário no mês/ano selecionado, considerando apenas dias já
  // encerrados (anteriores a hoje) — o dia atual, mesmo incompleto até agora,
  // ainda pode receber novas marcações e não é considerado inconsistente.
  const generateInconsistencies = () => {
    if (!inconsistencyUser || !inconsistencyMonth || !inconsistencyYear) return null;

    const user = users.find(u => u.id === inconsistencyUser);
    const userRecords = timeRecords.filter(r => r.userId === inconsistencyUser);

    const ano = parseInt(inconsistencyYear);
    const mes = parseInt(inconsistencyMonth);
    const diasNoMes = new Date(ano, mes, 0).getDate();

    const hoje = new Date();
    const hojeStr = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;

    const inconsistencias = [];
    for (let dia = 1; dia <= diasNoMes; dia++) {
      const dateStr = `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
      if (dateStr >= hojeStr) continue; // ignora hoje e datas futuras
      if (holidays.includes(dateStr)) continue; // dia marcado como feriado — resolvido

      const metrics = getDayMetrics(dateStr, userRecords);
      const diaSemana = getDiaSemana(dateStr);

      if (metrics.status === 'incompleto') {
        const motivo = metrics.saida === null && metrics.fimIntervalo === null
          ? 'Apenas 1 marcação registrada (entrada) — faltam início/fim do intervalo e a saída'
          : '3 marcações registradas (entrada, início e fim do intervalo) — falta a saída';
        inconsistencias.push({ ...metrics, diaSemana, motivo });
      } else if (metrics.status === 'sem-registro' && !diaSemana.isFimDeSemana) {
        inconsistencias.push({ ...metrics, diaSemana, motivo: 'Dia útil sem nenhuma marcação de ponto' });
      }
    }

    return { user, inconsistencias };
  };

  // Abre o modal de resolução, pré-preenchendo com os horários já existentes
  // (se houver) para aquele dia da inconsistência selecionada.
  const openResolveModal = (inconsistencia) => {
    setResolveDate(inconsistencia.date);
    setResolveEntrada(inconsistencia.entrada ? inconsistencia.entrada.substring(0, 5) : '');
    setResolveInicioIntervalo(inconsistencia.inicioIntervalo ? inconsistencia.inicioIntervalo.substring(0, 5) : '');
    setResolveFimIntervalo(inconsistencia.fimIntervalo ? inconsistencia.fimIntervalo.substring(0, 5) : '');
    setResolveSaida(inconsistencia.saida ? inconsistencia.saida.substring(0, 5) : '');
    setResolveHolidayDesc('Feriado');
    setResolveError('');
    setResolveModalTab('horarios');
    setResolveModalOpen(true);
  };

  const closeResolveModal = () => {
    setResolveModalOpen(false);
    setResolveError('');
  };

  // Salva a correção de horários: valida, apaga os lançamentos antigos do dia
  // e insere os novos, marcados como ajuste manual.
  const handleSaveHorarios = async () => {
    setResolveError('');

    if (!resolveEntrada || !resolveSaida) {
      setResolveError('Informe pelo menos um horário de entrada e um de saída.');
      return;
    }

    // Monta a lista de horários preenchidos, na ordem esperada
    const horarios = [
      { label: 'entrada', valor: resolveEntrada },
      ...(resolveInicioIntervalo ? [{ label: 'início intervalo', valor: resolveInicioIntervalo }] : []),
      ...(resolveFimIntervalo ? [{ label: 'fim intervalo', valor: resolveFimIntervalo }] : []),
      { label: 'saída', valor: resolveSaida },
    ];

    // Valida ordem cronológica estrita entre os horários preenchidos
    for (let i = 0; i < horarios.length - 1; i++) {
      if (horarios[i].valor >= horarios[i + 1].valor) {
        setResolveError(`O horário de "${horarios[i + 1].label}" precisa ser depois do de "${horarios[i].label}".`);
        return;
      }
    }
    // Regra explícita: início/fim de intervalo, se informados, devem ambos estar presentes
    if ((resolveInicioIntervalo && !resolveFimIntervalo) || (!resolveInicioIntervalo && resolveFimIntervalo)) {
      setResolveError('Preencha início E fim do intervalo, ou deixe os dois em branco.');
      return;
    }

    setResolveSaving(true);
    try {
      const usuarioAlvo = users.find(u => u.id === inconsistencyUser);

      // Remove os lançamentos antigos daquele dia (se houver)
      await supabaseRequest('registros_ponto', 'DELETE', {
        query: `?user_id=eq.${inconsistencyUser}&date=eq.${resolveDate}`
      });

      const novosPunches = horarios.map(h => `${h.valor}:00`);
      const linhas = novosPunches.map((time, idx) => ({
        user_id: inconsistencyUser,
        user_name: usuarioAlvo.name,
        date: resolveDate,
        time: time,
        datetime: `${resolveDate}T${time}`,
        type: idx % 2 === 0 ? 'entrada' : 'saída',
        manually_adjusted: true,
      }));

      const inseridos = await supabaseRequest('registros_ponto', 'POST', { body: linhas });
      const novosRegistros = inseridos.map(dbRecordToApp);

      // Atualiza o estado local: remove os antigos daquele dia/usuário e adiciona os novos
      setTimeRecords([
        ...timeRecords.filter(r => !(r.userId === inconsistencyUser && r.date === resolveDate)),
        ...novosRegistros,
      ]);

      closeResolveModal();
    } catch (error) {
      console.error('Erro ao salvar correção:', error);
      setResolveError('Erro ao salvar: ' + error.message);
    } finally {
      setResolveSaving(false);
    }
  };

  // Marca o dia como feriado: some da lista de inconsistências dali pra frente,
  // e remove eventuais lançamentos equivocados deste funcionário nesse dia.
  const handleMarkHoliday = async () => {
    setResolveError('');
    setResolveSaving(true);
    try {
      await supabaseRequest('feriados', 'POST', {
        body: { date: resolveDate, description: resolveHolidayDesc || 'Feriado' },
        query: '',
      }).catch(async (err) => {
        // Se já existir (conflito de data única), atualiza a descrição em vez de falhar
        await supabaseRequest('feriados', 'PATCH', {
          query: `?date=eq.${resolveDate}`,
          body: { description: resolveHolidayDesc || 'Feriado' }
        });
      });

      // Remove lançamentos equivocados deste funcionário nesse dia, já que
      // um feriado não deveria ter marcações de ponto.
      await supabaseRequest('registros_ponto', 'DELETE', {
        query: `?user_id=eq.${inconsistencyUser}&date=eq.${resolveDate}`
      });
      setTimeRecords(timeRecords.filter(r => !(r.userId === inconsistencyUser && r.date === resolveDate)));

      setHolidays([...holidays, resolveDate]);
      closeResolveModal();
    } catch (error) {
      console.error('Erro ao marcar feriado:', error);
      setResolveError('Erro ao salvar: ' + error.message);
    } finally {
      setResolveSaving(false);
    }
  };

  const formatDate = (dateStr) => {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const NOMES_DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

  // Retorna o nome do dia da semana e se é fim de semana, a partir de "YYYY-MM-DD".
  // Usa os componentes da data diretamente (em vez de new Date(dateStr) puro)
  // para evitar problemas de fuso horário que deslocariam o dia da semana.
  const getDiaSemana = (dateStr) => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const data = new Date(year, month - 1, day);
    const indice = data.getDay(); // 0 = domingo, 6 = sábado
    return { nome: NOMES_DIAS_SEMANA[indice], isFimDeSemana: indice === 0 || indice === 6 };
  };

  // Renderização da tela de login
  if (showLogin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)'
      }}>
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-8 text-white">
              <div className="flex items-center justify-center mb-4">
                <Clock className="w-16 h-16" />
              </div>
              <h1 className="text-3xl font-bold text-center">Controle de Ponto</h1>
              <p className="text-center text-indigo-100 mt-2">Sistema de Gestão de Horários</p>
              <p className="text-center text-indigo-200 text-xs mt-3 font-mono bg-black/20 rounded px-2 py-1 inline-block w-full">
                {APP_VERSION}
              </p>
            </div>
            
            {isLoading ? (
              <div className="p-8 text-center">
                <div className="inline-block w-8 h-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                <p className="text-gray-600">Carregando dados...</p>
              </div>
            ) : loadError ? (
              <div className="p-8 text-center">
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-4 mb-4 text-left">
                  <p className="font-semibold mb-1">Não foi possível carregar os dados</p>
                  <p>{loadError}</p>
                </div>
                <button
                  onClick={loadData}
                  className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all active:scale-95 shadow-lg"
                >
                  Tentar novamente
                </button>
              </div>
            ) : !showPasswordSetup ? (
              <div className="p-8">
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">E-mail</label>
                    <input
                      type="email"
                      value={loginEmail}
                      onChange={(e) => { setLoginEmail(e.target.value); setLoginError(''); }}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
                      placeholder="seu@email.com"
                      autoCapitalize="none"
                      autoCorrect="off"
                      onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Senha</label>
                    <input
                      type="password"
                      value={loginPassword}
                      onChange={(e) => { setLoginPassword(e.target.value); setLoginError(''); }}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
                      placeholder="••••••••"
                      onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                    />
                  </div>
                  
                  {loginError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                      {loginError}
                    </div>
                  )}
                  
                  <button
                    onClick={handleLogin}
                    className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all active:scale-95 shadow-lg"
                  >
                    <LogIn className="inline mr-2 w-5 h-5" />
                    Entrar
                  </button>
                </div>
                
                <div className="mt-6 pt-6 border-t border-gray-200 text-center text-sm text-gray-600">
                  <p>Primeiro acesso? Use a senha padrão: <strong>123456</strong></p>
                  <p className="mt-2">Admin: admin@admin.com / admin</p>
                </div>
              </div>
            ) : (
              <div className="p-8">
                <h2 className="text-2xl font-bold text-gray-800 mb-2">Primeiro Acesso</h2>
                <p className="text-gray-600 mb-6">Configure sua senha pessoal</p>
                
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Nova Senha</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => { setNewPassword(e.target.value); setPasswordError(''); }}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
                      placeholder="Mínimo 4 caracteres"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Confirmar Senha</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(''); }}
                      className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:border-indigo-500 focus:outline-none transition-colors"
                      placeholder="Digite a senha novamente"
                      onKeyPress={(e) => e.key === 'Enter' && handlePasswordSetup()}
                    />
                  </div>
                  
                  {passwordError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                      {passwordError}
                    </div>
                  )}
                  
                  <div className="flex gap-3">
                    <button
                      onClick={() => {
                        setShowPasswordSetup(false);
                        setNewPassword('');
                        setConfirmPassword('');
                        setPasswordError('');
                      }}
                      className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-300 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handlePasswordSetup}
                      className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-semibold hover:from-indigo-700 hover:to-purple-700 transition-all"
                    >
                      Confirmar
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Renderização do sistema principal
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2 sm:space-x-3 min-w-0">
              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-2 rounded-lg flex-shrink-0">
                <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
              </div>
              <div className="min-w-0">
                <h1 className="text-base sm:text-2xl font-bold text-gray-900 truncate">Controle de Ponto</h1>
                <p className="text-xs sm:text-sm text-gray-600 truncate">
                  {currentUser?.name} ({currentUser?.profile === 'admin' ? 'Admin' : 'Funcionário'})
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 sm:gap-2 px-3 sm:px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors font-medium flex-shrink-0"
            >
              <LogOut className="w-5 h-5" />
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="bg-white border-b border-gray-200 overflow-x-auto">
        <div className="max-w-7xl mx-auto px-2 sm:px-6 lg:px-8">
          <div className="flex space-x-1 whitespace-nowrap">
            {currentUser?.profile === 'employee' && (
              <button
                onClick={() => setActiveView('clock')}
                className={`px-4 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-medium transition-colors border-b-2 ${
                  activeView === 'clock'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <Clock className="inline w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
                Registrar Ponto
              </button>
            )}
            
            {currentUser?.profile === 'admin' && (
              <>
                <button
                  onClick={() => setActiveView('users')}
                  className={`px-3 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-medium transition-colors border-b-2 ${
                    activeView === 'users'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Users className="inline w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
                  Usuários
                </button>
                
                <button
                  onClick={() => setActiveView('records')}
                  className={`px-3 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-medium transition-colors border-b-2 ${
                    activeView === 'records'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Search className="inline w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
                  Registros
                </button>
                
                <button
                  onClick={() => setActiveView('report')}
                  className={`px-3 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-medium transition-colors border-b-2 ${
                    activeView === 'report'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <FileText className="inline w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
                  Relatórios
                </button>

                <button
                  onClick={() => setActiveView('inconsistencies')}
                  className={`px-3 sm:px-6 py-3 sm:py-4 text-sm sm:text-base font-medium transition-colors border-b-2 ${
                    activeView === 'inconsistencies'
                      ? 'border-indigo-600 text-indigo-600'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <AlertTriangle className="inline w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
                  Inconsistências
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Tela de Registro de Ponto */}
        {activeView === 'clock' && currentUser?.profile === 'employee' && (
          <div className="max-w-2xl mx-auto">
            <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
              <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-5 sm:p-8 text-white text-center">
                <Clock className="w-14 h-14 sm:w-20 sm:h-20 mx-auto mb-3 sm:mb-4" />
                <h2 className="text-2xl sm:text-3xl font-bold mb-2">Registrar Ponto</h2>
                <p className="text-sm sm:text-lg text-indigo-100 capitalize">
                  {new Date().toLocaleDateString('pt-BR', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </p>
                <p className="text-3xl sm:text-4xl font-bold mt-3 sm:mt-4">
                  {new Date().toLocaleTimeString('pt-BR')}
                </p>
              </div>
              
              <div className="p-5 sm:p-8">
                <button
                  onClick={handleOpenClockModal}
                  className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-5 sm:py-6 rounded-xl font-bold text-lg sm:text-xl hover:from-indigo-700 hover:to-purple-700 transition-all active:scale-95 shadow-lg"
                >
                  REGISTRAR PONTO
                </button>
                
                {clockMessage && (
                  <div className={`mt-4 rounded-lg px-4 py-3 text-center font-semibold ${
                    clockMessage.error 
                      ? 'bg-red-50 border border-red-200 text-red-700' 
                      : 'bg-green-50 border border-green-200 text-green-700'
                  }`}>
                    {clockMessage.text}
                  </div>
                )}
                
                <div className="mt-6 sm:mt-8">
                  <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-3 sm:mb-4">Registros de Hoje</h3>
                  <div className="space-y-2">
                    {currentUser && timeRecords
                      .filter(r => r.userId === currentUser.id && r.date === new Date().toISOString().split('T')[0])
                      .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
                      .map(record => (
                        <div key={record.id} className="p-3 sm:p-4 bg-gray-50 rounded-lg">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className={`w-3 h-3 rounded-full ${record.type === 'entrada' ? 'bg-green-500' : 'bg-red-500'}`}></div>
                              <span className="font-semibold text-gray-700 capitalize">{record.type}</span>
                            </div>
                            <span className="text-gray-600 font-mono">{record.time}</span>
                          </div>
                          {record.address && (
                            <p className="text-xs text-gray-500 mt-1 pl-6">📍 {record.address}</p>
                          )}
                        </div>
                      ))}
                    {currentUser && timeRecords.filter(r => r.userId === currentUser.id && r.date === new Date().toISOString().split('T')[0]).length === 0 && (
                      <p className="text-gray-500 text-center py-4">Nenhum registro hoje</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tela de Gerenciamento de Usuários */}
        {activeView === 'users' && currentUser?.profile === 'admin' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-900">Gerenciamento de Usuários</h2>
              <button
                onClick={() => setShowUserForm(!showUserForm)}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
              >
                <Plus className="w-5 h-5" />
                Novo Usuário
              </button>
            </div>

            <div className="flex flex-wrap gap-2 mb-6">
              <button
                onClick={handleExportBackup}
                className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium"
              >
                <Download className="w-4 h-4" />
                Baixar backup (.json)
              </button>
              <label className="flex items-center gap-2 px-3 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium cursor-pointer">
                <Save className="w-4 h-4" />
                Importar backup
                <input type="file" accept=".json" onChange={handleImportBackup} className="hidden" />
              </label>
            </div>

            {showUserForm && (
              <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
                <h3 className="text-xl font-semibold text-gray-800 mb-4">Cadastrar Novo Usuário</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
                    <input
                      type="text"
                      value={newUser.name}
                      onChange={(e) => setNewUser({ ...newUser, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                      placeholder="Nome completo"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">E-mail</label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                      placeholder="email@exemplo.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">Perfil</label>
                    <select
                      value={newUser.profile}
                      onChange={(e) => setNewUser({ ...newUser, profile: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="employee">Funcionário</option>
                      <option value="admin">Administrador</option>
                    </select>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => {
                      setShowUserForm(false);
                      setNewUser({ name: '', email: '', profile: 'employee' });
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                  >
                    <X className="inline w-5 h-5 mr-1" />
                    Cancelar
                  </button>
                  <button
                    onClick={handleAddUser}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors font-medium"
                  >
                    <Save className="inline w-5 h-5 mr-1" />
                    Salvar
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Nome</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">E-mail</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Perfil</th>
                    <th className="px-6 py-4 text-right text-sm font-semibold text-gray-700">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {users.map(user => (
                    <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                      {editingUser && editingUser.id === user.id ? (
                        <>
                          <td className="px-6 py-4">
                            <input
                              type="text"
                              value={editingUser.name}
                              onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                            />
                          </td>
                          <td className="px-6 py-4">
                            <input
                              type="email"
                              value={editingUser.email}
                              onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                            />
                          </td>
                          <td className="px-6 py-4">
                            <select
                              value={editingUser.profile}
                              onChange={(e) => setEditingUser({ ...editingUser, profile: e.target.value })}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                              disabled={user.email === 'admin@admin.com'}
                            >
                              <option value="employee">Funcionário</option>
                              <option value="admin">Administrador</option>
                            </select>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={handleSaveEdit}
                                className="p-2 bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors"
                              >
                                <Save className="w-5 h-5" />
                              </button>
                              <button
                                onClick={() => setEditingUser(null)}
                                className="p-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                              >
                                <X className="w-5 h-5" />
                              </button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-6 py-4 font-medium text-gray-900">{user.name}</td>
                          <td className="px-6 py-4 text-gray-600">{user.email}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                              user.profile === 'admin' 
                                ? 'bg-purple-100 text-purple-700' 
                                : 'bg-blue-100 text-blue-700'
                            }`}>
                              {user.profile === 'admin' ? 'Administrador' : 'Funcionário'}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex gap-2 justify-end">
                              <button
                                onClick={() => handleEditUser(user)}
                                className="p-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                              >
                                <Edit2 className="w-5 h-5" />
                              </button>
                              <button
                                onClick={() => handleDeleteUser(user.id)}
                                className="p-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors"
                                disabled={user.email === 'admin@admin.com'}
                              >
                                <Trash2 className="w-5 h-5" />
                              </button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tela de Consulta de Registros */}
        {activeView === 'records' && currentUser?.profile === 'admin' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Consultar Registros de Ponto</h2>
            
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Filtros</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Nome do Funcionário</label>
                  <input
                    type="text"
                    value={filterName}
                    onChange={(e) => setFilterName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                    placeholder="Digite o nome..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mês</label>
                  <select
                    value={filterMonth}
                    onChange={(e) => setFilterMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">Todos</option>
                    <option value="01">Janeiro</option>
                    <option value="02">Fevereiro</option>
                    <option value="03">Março</option>
                    <option value="04">Abril</option>
                    <option value="05">Maio</option>
                    <option value="06">Junho</option>
                    <option value="07">Julho</option>
                    <option value="08">Agosto</option>
                    <option value="09">Setembro</option>
                    <option value="10">Outubro</option>
                    <option value="11">Novembro</option>
                    <option value="12">Dezembro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Ano</label>
                  <input
                    type="number"
                    value={filterYear}
                    onChange={(e) => setFilterYear(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                    placeholder="2024"
                  />
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-lg overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Funcionário</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Data</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Hora</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Tipo</th>
                    <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Localização</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {getFilteredRecords().map(record => (
                    <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900">{record.userName}</td>
                      <td className="px-6 py-4 text-gray-600">{formatDate(record.date)}</td>
                      <td className="px-6 py-4 text-gray-600 font-mono">{record.time}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold ${
                          record.type === 'entrada' 
                            ? 'bg-green-100 text-green-700' 
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {record.type.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-gray-500 text-xs max-w-xs">
                        {record.address ? (
                          <a
                            href={`https://www.google.com/maps?q=${record.latitude},${record.longitude}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-indigo-600 hover:underline"
                            title={record.address}
                          >
                            📍 {record.address.split(',').slice(0, 2).join(',')}
                          </a>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {getFilteredRecords().length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  Nenhum registro encontrado
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tela de Relatórios */}
        {activeView === 'report' && currentUser?.profile === 'admin' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Relatório de Ponto</h2>
            
            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Gerar Relatório</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Funcionário</label>
                  <select
                    value={reportUser}
                    onChange={(e) => setReportUser(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {users.filter(u => u.profile === 'employee').map(user => (
                      <option key={user.id} value={user.id}>{user.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mês</label>
                  <select
                    value={reportMonth}
                    onChange={(e) => setReportMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="01">Janeiro</option>
                    <option value="02">Fevereiro</option>
                    <option value="03">Março</option>
                    <option value="04">Abril</option>
                    <option value="05">Maio</option>
                    <option value="06">Junho</option>
                    <option value="07">Julho</option>
                    <option value="08">Agosto</option>
                    <option value="09">Setembro</option>
                    <option value="10">Outubro</option>
                    <option value="11">Novembro</option>
                    <option value="12">Dezembro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Ano</label>
                  <input
                    type="number"
                    value={reportYear}
                    onChange={(e) => setReportYear(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                    placeholder="2026"
                  />
                </div>
              </div>
            </div>

            {!reportUser ? (
              <div className="bg-white rounded-xl shadow-lg p-8 text-center text-gray-500">
                Selecione um funcionário para gerar o relatório.
              </div>
            ) : (() => {
              const report = generateReport();
              if (!report) return null;
              const nomesMeses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
              return (
                <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                  <div className="bg-gradient-to-r from-indigo-600 to-purple-600 p-6 text-white">
                    <h3 className="text-2xl font-bold mb-2">Relatório de Ponto</h3>
                    <p className="text-lg">Funcionário: {report.user.name}</p>
                    <p className="text-indigo-100">
                      Período: {nomesMeses[parseInt(reportMonth)]} de {reportYear}
                    </p>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">Data</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">Dia</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">Entrada</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">Início intervalo</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">Fim intervalo</th>
                          <th className="px-4 py-3 text-left font-semibold text-gray-700 whitespace-nowrap">Saída</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">Horas trabalhadas</th>
                          <th className="px-4 py-3 text-right font-semibold text-gray-700 whitespace-nowrap">Horas extras</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {report.dias.map((dia) => {
                          const diaSemana = getDiaSemana(dia.date);
                          return (
                          <tr key={dia.date} className={`${dia.status === 'sem-registro' ? 'text-gray-300' : 'text-gray-700'} ${diaSemana.isFimDeSemana ? 'bg-gray-50' : ''}`}>
                            <td className="px-4 py-2 whitespace-nowrap font-medium">
                              {formatDate(dia.date)}
                              {dia.isManuallyAdjusted && (
                                <span title="Ajuste manual" className="ml-1.5 text-xs text-indigo-500">🔧</span>
                              )}
                            </td>
                            <td className={`px-4 py-2 whitespace-nowrap ${diaSemana.isFimDeSemana ? 'font-semibold text-gray-500' : ''}`}>{diaSemana.nome}</td>
                            <td className="px-4 py-2 whitespace-nowrap font-mono">{formatHoraCurta(dia.entrada)}</td>
                            <td className="px-4 py-2 whitespace-nowrap font-mono">{formatHoraCurta(dia.inicioIntervalo)}</td>
                            <td className="px-4 py-2 whitespace-nowrap font-mono">{formatHoraCurta(dia.fimIntervalo)}</td>
                            <td className="px-4 py-2 whitespace-nowrap font-mono">{formatHoraCurta(dia.saida)}</td>
                            <td className="px-4 py-2 whitespace-nowrap text-right font-semibold">
                              {dia.status === 'incompleto' ? (
                                <span className="text-amber-600 text-xs">incompleto</span>
                              ) : (
                                formatHoras(dia.horasTrabalhadas)
                              )}
                            </td>
                            <td className={`px-4 py-2 whitespace-nowrap text-right font-semibold ${
                              dia.horasExtras === null ? '' : dia.horasExtras < 0 ? 'text-red-600' : 'text-green-600'
                            }`}>
                              {dia.status === 'incompleto' ? '—' : formatHoras(dia.horasExtras)}
                            </td>
                          </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                        <tr>
                          <td colSpan={6} className="px-4 py-3 text-right font-bold text-gray-900">Total do mês</td>
                          <td className="px-4 py-3 text-right font-bold text-gray-900">{formatHoras(report.totalHorasTrabalhadas)}</td>
                          <td className={`px-4 py-3 text-right font-bold ${report.totalHorasExtras < 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {formatHoras(report.totalHorasExtras)}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <div className="px-6 py-4 text-xs text-gray-400 border-t border-gray-100">
                    * Dias com apenas 2 marcações consideram 1 hora de intervalo automática. Dias com 1 ou 3 marcações aparecem como "incompleto" e não entram no somatório. Dias sem nenhuma marcação não entram no somatório.
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* Tela de Inconsistências */}
        {activeView === 'inconsistencies' && currentUser?.profile === 'admin' && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Inconsistências</h2>

            <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
              <h3 className="text-lg font-semibold text-gray-800 mb-4">Buscar Inconsistências</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Funcionário</label>
                  <select
                    value={inconsistencyUser}
                    onChange={(e) => setInconsistencyUser(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="">Selecione...</option>
                    {users.filter(u => u.profile === 'employee').map(user => (
                      <option key={user.id} value={user.id}>{user.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Mês</label>
                  <select
                    value={inconsistencyMonth}
                    onChange={(e) => setInconsistencyMonth(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="01">Janeiro</option>
                    <option value="02">Fevereiro</option>
                    <option value="03">Março</option>
                    <option value="04">Abril</option>
                    <option value="05">Maio</option>
                    <option value="06">Junho</option>
                    <option value="07">Julho</option>
                    <option value="08">Agosto</option>
                    <option value="09">Setembro</option>
                    <option value="10">Outubro</option>
                    <option value="11">Novembro</option>
                    <option value="12">Dezembro</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Ano</label>
                  <input
                    type="number"
                    value={inconsistencyYear}
                    onChange={(e) => setInconsistencyYear(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                    placeholder="2026"
                  />
                </div>
              </div>
            </div>

            {!inconsistencyUser ? (
              <div className="bg-white rounded-xl shadow-lg p-8 text-center text-gray-500">
                Selecione um funcionário para buscar inconsistências.
              </div>
            ) : (() => {
              const resultado = generateInconsistencies();
              if (!resultado) return null;
              const nomesMeses = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
              return (
                <div className="bg-white rounded-xl shadow-lg overflow-hidden">
                  <div className="bg-gradient-to-r from-amber-500 to-orange-500 p-6 text-white">
                    <h3 className="text-2xl font-bold mb-2 flex items-center gap-2">
                      <AlertTriangle className="w-6 h-6" />
                      Inconsistências Encontradas
                    </h3>
                    <p className="text-lg">Funcionário: {resultado.user.name}</p>
                    <p className="text-amber-100">
                      Período: {nomesMeses[parseInt(inconsistencyMonth)]} de {inconsistencyYear}
                    </p>
                  </div>

                  <div className="p-6">
                    {resultado.inconsistencias.length === 0 ? (
                      <p className="text-center text-gray-500 py-8">
                        ✅ Nenhuma inconsistência encontrada neste período.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {resultado.inconsistencias.map((inc) => (
                          <div key={inc.date} className="border border-amber-200 bg-amber-50 rounded-lg p-4">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="font-semibold text-gray-900">
                                {formatDate(inc.date)} — {inc.diaSemana.nome}
                              </h4>
                              <button
                                onClick={() => openResolveModal(inc)}
                                className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors flex-shrink-0"
                              >
                                Corrigir
                              </button>
                            </div>
                            <p className="text-sm text-amber-800 mb-2">{inc.motivo}</p>
                            <div className="flex flex-wrap gap-3 text-xs text-gray-600 font-mono">
                              <span>Entrada: {formatHoraCurta(inc.entrada)}</span>
                              <span>Início intervalo: {formatHoraCurta(inc.inicioIntervalo)}</span>
                              <span>Fim intervalo: {formatHoraCurta(inc.fimIntervalo)}</span>
                              <span>Saída: {formatHoraCurta(inc.saida)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </main>

      {/* Modal de resolução de inconsistência */}
      {resolveModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900">
                Corrigir {formatDate(resolveDate)}
              </h3>
              <button onClick={closeResolveModal} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="flex border-b border-gray-200">
              <button
                onClick={() => setResolveModalTab('horarios')}
                className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                  resolveModalTab === 'horarios' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'
                }`}
              >
                Corrigir horários
              </button>
              <button
                onClick={() => setResolveModalTab('feriado')}
                className={`flex-1 py-3 text-sm font-semibold transition-colors ${
                  resolveModalTab === 'feriado' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-gray-500'
                }`}
              >
                Marcar como feriado
              </button>
            </div>

            <div className="p-5">
              {resolveModalTab === 'horarios' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Entrada *</label>
                      <input
                        type="time"
                        value={resolveEntrada}
                        onChange={(e) => setResolveEntrada(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Saída *</label>
                      <input
                        type="time"
                        value={resolveSaida}
                        onChange={(e) => setResolveSaida(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Início intervalo</label>
                      <input
                        type="time"
                        value={resolveInicioIntervalo}
                        onChange={(e) => setResolveInicioIntervalo(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Fim intervalo</label>
                      <input
                        type="time"
                        value={resolveFimIntervalo}
                        onChange={(e) => setResolveFimIntervalo(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">
                    Entrada e Saída são obrigatórios. Intervalo é opcional, mas se preencher um, precisa preencher os dois.
                  </p>

                  {resolveError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                      {resolveError}
                    </div>
                  )}

                  <button
                    onClick={handleSaveHorarios}
                    disabled={resolveSaving}
                    className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-bold hover:from-indigo-700 hover:to-purple-700 transition-all disabled:opacity-50"
                  >
                    {resolveSaving ? 'Salvando...' : 'Salvar correção'}
                  </button>
                  <p className="text-xs text-gray-400 text-center">
                    Isso substitui todos os lançamentos deste dia e marca como ajuste manual.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
                    Marcar este dia como feriado remove qualquer lançamento deste funcionário na data e impede que ela volte a aparecer como inconsistência.
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Descrição (opcional)</label>
                    <input
                      type="text"
                      value={resolveHolidayDesc}
                      onChange={(e) => setResolveHolidayDesc(e.target.value)}
                      placeholder="Ex: Feriado municipal"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:border-indigo-500 focus:outline-none"
                    />
                  </div>

                  {resolveError && (
                    <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                      {resolveError}
                    </div>
                  )}

                  <button
                    onClick={handleMarkHoliday}
                    disabled={resolveSaving}
                    className="w-full bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-bold hover:from-indigo-700 hover:to-purple-700 transition-all disabled:opacity-50"
                  >
                    {resolveSaving ? 'Salvando...' : 'Confirmar feriado'}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal de confirmação de ponto com mapa (somente visualização) */}
      {clockModalOpen && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <MapPin className="w-5 h-5 text-indigo-600" />
                Confirmar Registro de Ponto
              </h3>
              <button onClick={handleCloseClockModal} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            </div>

            <div className="p-5">
              {(clockModalStatus === 'checking-permission' || clockModalStatus === 'loading-location') && (
                <div className="py-12 text-center">
                  <div className="inline-block w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                  <p className="text-gray-600 font-medium">
                    {clockModalStatus === 'checking-permission' ? 'Verificando permissão de localização...' : 'Obtendo sua localização...'}
                  </p>
                  <p className="text-gray-400 text-sm mt-1">Isso pode levar alguns segundos</p>
                </div>
              )}

              {clockModalStatus === 'permission-denied' && (
                <div className="py-6">
                  <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
                    <div className="flex gap-3">
                      <AlertTriangle className="w-6 h-6 text-amber-600 flex-shrink-0" />
                      <div>
                        <p className="font-semibold text-amber-800">Permissão de localização bloqueada</p>
                        <p className="text-amber-700 text-sm mt-1">
                          O registro de ponto exige acesso à sua localização. Seu navegador ou celular está bloqueando esse acesso.
                        </p>
                      </div>
                    </div>
                  </div>
                  <p className="text-gray-700 text-sm font-medium mb-2">Como permitir:</p>
                  <ul className="text-gray-600 text-sm space-y-1.5 list-disc pl-5 mb-4">
                    <li><strong>iPhone:</strong> Ajustes → Privacidade e Segurança → Serviços de Localização → seu navegador → "Perguntar" ou "Sempre"</li>
                    <li><strong>Android:</strong> Configurações → Apps → seu navegador → Permissões → Localização → Permitir</li>
                    <li>Depois, atualize a página e tente registrar o ponto de novo</li>
                  </ul>
                  <button
                    onClick={handleOpenClockModal}
                    className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              {clockModalStatus === 'error' && (
                <div className="py-6">
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
                    <p className="font-semibold text-red-700">Não foi possível obter sua localização</p>
                    <p className="text-red-600 text-sm mt-1">{clockModalErrorMsg}</p>
                  </div>
                  <button
                    onClick={handleOpenClockModal}
                    className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition-colors"
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              {(clockModalStatus === 'geocoding' || clockModalStatus === 'ready') && clockModalPosition && (
                <div>
                  <div className="rounded-xl overflow-hidden border border-gray-200 mb-4" style={{ height: '260px' }}>
                    <MapContainer
                      center={[clockModalPosition.latitude, clockModalPosition.longitude]}
                      zoom={17}
                      style={{ height: '100%', width: '100%' }}
                      dragging={false}
                      zoomControl={false}
                      scrollWheelZoom={false}
                      doubleClickZoom={false}
                      touchZoom={false}
                      attributionControl={false}
                    >
                      <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      />
                      <Marker
                        position={[clockModalPosition.latitude, clockModalPosition.longitude]}
                        icon={marcadorIcon}
                      />
                    </MapContainer>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-3 mb-4 min-h-[3.5rem] flex items-center">
                    {clockModalStatus === 'geocoding' ? (
                      <p className="text-gray-500 text-sm flex items-center gap-2">
                        <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-gray-500 rounded-full animate-spin"></span>
                        Identificando endereço...
                      </p>
                    ) : (
                      <p className="text-gray-700 text-sm">
                        📍 {clockModalAddress || 'Endereço não identificado (coordenadas capturadas normalmente)'}
                      </p>
                    )}
                  </div>

                  <p className="text-xs text-gray-400 mb-4 text-center">
                    Esta é a sua localização atual, obtida pelo GPS do dispositivo. Não é possível alterá-la manualmente.
                  </p>

                  <div className="flex gap-3">
                    <button
                      onClick={handleCloseClockModal}
                      className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg font-semibold hover:bg-gray-200 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleConfirmClockIn}
                      disabled={clockModalStatus !== 'ready' || isConfirmingClockIn}
                      className="flex-1 bg-gradient-to-r from-indigo-600 to-purple-600 text-white py-3 rounded-lg font-bold hover:from-indigo-700 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isConfirmingClockIn ? 'Registrando...' : 'Confirmar Registro'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ControlePonto;
